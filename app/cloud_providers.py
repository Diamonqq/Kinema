"""Official-host API adapters: exact selected model, bounded I/O, no retries or fallback."""
from __future__ import annotations

import asyncio
import base64
import copy
import json
import re
import time
from pathlib import Path

import httpx

from .providers import IMAGE_TYPES, MAX_IMAGE_BYTES, ProviderError

BASES = {'openai': 'https://api.openai.com/v1', 'anthropic': 'https://api.anthropic.com/v1',
         'gemini': 'https://generativelanguage.googleapis.com/v1beta',
         'kimi': 'https://api.moonshot.ai/v1', 'openrouter': 'https://openrouter.ai/api/v1'}
_TRANSPORT = None  # Tests replace this with MockTransport; no custom URL setting is exposed.
MAX_REPLY = 8 * 1024 * 1024
MODEL_ID = re.compile(r'^[A-Za-z0-9][A-Za-z0-9._:/-]{0,190}$')
NON_CHAT = re.compile(r'audio|realtime|image|embedding|moderation|transcri|tts|whisper|dall-e|search|research|computer|live|robotic|veo|imagen', re.I)


def _headers(pid, key):
    if pid == 'anthropic':
        return {'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json'}
    if pid == 'gemini':
        return {'x-goog-api-key': key, 'content-type': 'application/json'}
    return {'Authorization': 'Bearer ' + key, 'content-type': 'application/json'}


def _http_error(code):
    if code in (401, 403):
        return 'The provider rejected this API key or account permission. Check Connections.'
    if code in (402, 429):
        return 'The provider reported a credit, quota or rate limit. Nothing was retried; check your provider account.'
    if 300 <= code < 400:
        return 'The provider requested a redirect. Kinema refused to send credentials to another endpoint.'
    if code == 400:
        return 'The provider rejected the selected model or request format. Verify the connection and choose a supported model.'
    if code == 404:
        return 'The selected model or API endpoint is unavailable. Verify the connection.'
    return f'The provider request failed (HTTP {code}). Nothing was retried.'


async def _request_async(pid, path, key, *, method='GET', payload=None, params=None, timeout=25, cancel=None):
    if pid not in BASES or not path.startswith('/') or '?' in path or '..' in path:
        raise ProviderError('Unsupported provider endpoint.')
    if cancel and cancel.is_set():
        raise ProviderError('Stopped. No new provider request was sent.')
    deadline = time.monotonic() + min(max(float(timeout), .1), 600)
    async with httpx.AsyncClient(transport=_TRANSPORT, trust_env=False, follow_redirects=False,
                                 timeout=httpx.Timeout(min(timeout, 60), connect=min(timeout, 10))) as client:
        async def read():
            async with client.stream(method, BASES[pid] + path, headers=_headers(pid, key), json=payload, params=params) as response:
                if response.status_code != 200:
                    raise ProviderError(_http_error(response.status_code))
                data = bytearray()
                async for chunk in response.aiter_bytes():
                    data.extend(chunk)
                    if len(data) > MAX_REPLY:
                        raise ProviderError('The provider response exceeded the size limit.')
                try:
                    value = json.loads(data)
                except (ValueError, UnicodeError):
                    raise ProviderError('The provider returned an unreadable response.') from None
                if not isinstance(value, dict):
                    raise ProviderError('The provider returned an unexpected response.')
                return value
        task = asyncio.create_task(read())
        try:
            while not task.done():
                if cancel and cancel.is_set():
                    raise ProviderError('Stopped. The local connection was closed; the provider may already have processed the request.')
                if time.monotonic() >= deadline:
                    raise ProviderError('The provider request timed out. Nothing was retried.')
                await asyncio.wait({task}, timeout=min(.05, max(.001, deadline - time.monotonic())))
            return task.result()
        finally:
            if not task.done():
                task.cancel()
            await asyncio.gather(task, return_exceptions=True)


def _request(pid, path, key, **kwargs):
    try:
        return asyncio.run(_request_async(pid, path, key, **kwargs))
    except ProviderError:
        raise
    except (httpx.HTTPError, OSError, ValueError, TypeError):
        # Never include response bodies, request headers, URLs, keys or exception text.
        raise ProviderError('The provider could not be reached or returned invalid data. Nothing was retried.') from None


def _supported(value):
    return value is True or isinstance(value, dict) and value.get('supported') is True


def normalize_models(pid, rows):
    """The provider is authoritative for IDs. Unknown effort controls stay at Default."""
    found = {}
    for raw in rows[:2000]:
        if not isinstance(raw, dict):
            continue
        name = raw.get('name', '') if pid == 'gemini' else raw.get('id', '')
        if pid == 'gemini':
            name = name.removeprefix('models/') if isinstance(name, str) else ''
        if not isinstance(name, str) or not MODEL_ID.fullmatch(name) or '..' in name:
            continue
        efforts, image, structured, max_output = ['default'], False, False, 16384
        if pid == 'openai':
            if not re.match(r'^(?:gpt-(?:4o|4\.1|5|6)|o[34])(?:[-.]|$)', name) or NON_CHAT.search(name):
                continue
            # These documented general-purpose families take images and structured Responses.
            image, structured = True, True
        elif pid == 'anthropic':
            caps = raw.get('capabilities') or {}
            lifecycle = raw.get('lifecycle')
            if lifecycle and lifecycle not in ('active', {'status': 'active'}):
                continue
            if not name.startswith('claude-'):
                continue
            effort = caps.get('effort') or {}
            efforts += [e for e in ('low', 'medium', 'high', 'xhigh', 'max') if _supported(effort.get(e))]
            image = _supported(caps.get('image_input'))
            structured = _supported(caps.get('structured_outputs'))
            max_output = raw.get('max_tokens') or max_output
        elif pid == 'gemini':
            if not name.startswith('gemini-') or 'generateContent' not in raw.get('supportedGenerationMethods', []) or NON_CHAT.search(name):
                continue
            # Ordinary Gemini generation models are multimodal; specialized output models above are omitted.
            image = bool(re.match(r'^gemini-(?:2\.5|3(?:\.|-))', name))
            structured = image
            max_output = raw.get('outputTokenLimit') or max_output
        elif pid == 'kimi':
            if not name.startswith(('kimi-', 'moonshot-')):
                continue
            if name == 'kimi-k3' or name.startswith('kimi-k3-'):
                efforts += ['low', 'high', 'max']
            image = '-vision-' in name or name in ('kimi-k2.5', 'kimi-k2.6', 'kimi-k3')
        elif pid == 'openrouter':
            architecture = raw.get('architecture') or {}
            if name == 'openrouter/auto' or 'text' not in architecture.get('output_modalities', []):
                continue
            if 'structured_outputs' not in raw.get('supported_parameters', []):
                continue
            image = 'image' in architecture.get('input_modalities', [])
            structured = True
            max_output = (raw.get('top_provider') or {}).get('max_completion_tokens') or max_output
        else:
            continue
        if not isinstance(max_output, int) or isinstance(max_output, bool) or max_output < 256:
            max_output = 16384
        label = raw.get('display_name') or raw.get('displayName') or raw.get('name') or name
        found[name] = {'id': pid + ':' + name, 'label': str(label)[:160], 'provider': pid,
                       'efforts': efforts, 'default_effort': 'default', 'speeds': ['standard'],
                       'image_input': image, 'structured_output': structured,
                       'max_output_tokens': min(max_output, 16384)}
    return sorted(found.values(), key=lambda m: m['label'].lower())


def _verify(pid, key):
    if pid not in BASES:
        raise ProviderError('Unsupported provider.')
    if pid == 'openrouter':
        auth = _request(pid, '/key', key, timeout=12)
        if not isinstance(auth.get('data'), dict):
            raise ProviderError('OpenRouter did not confirm this API key.')
    params = {'limit': 1000} if pid == 'anthropic' else {'pageSize': 1000} if pid == 'gemini' else None
    response = _request(pid, '/models', key, params=params, timeout=15)
    rows = response.get('models' if pid == 'gemini' else 'data')
    if not isinstance(rows, list):
        raise ProviderError('The provider did not return its model list.')
    # At most two metadata pages; never an unbounded background account crawl.
    if pid == 'anthropic' and response.get('has_more') and isinstance(response.get('last_id'), str):
        more = _request(pid, '/models', key, params={'limit': 1000, 'after_id': response['last_id']}, timeout=12)
        rows += more.get('data', []) if isinstance(more.get('data'), list) else []
    elif pid == 'gemini' and isinstance(response.get('nextPageToken'), str):
        more = _request(pid, '/models', key, params={'pageSize': 1000, 'pageToken': response['nextPageToken']}, timeout=12)
        rows += more.get('models', []) if isinstance(more.get('models'), list) else []
    return normalize_models(pid, rows)


def verify(pid, key):
    try:
        return _verify(pid, key)
    except (KeyError, TypeError, AttributeError, IndexError):
        raise ProviderError('The provider returned an unexpected model catalog. Nothing was saved.') from None


def _schema(value, strict=False):
    """Adapt our object schema to provider subsets; application validators retain original constraints."""
    if isinstance(value, list):
        return [_schema(x, strict) for x in value]
    if not isinstance(value, dict):
        return value
    result = {k: _schema(v, strict) for k, v in value.items()
              if k not in ('minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'minLength', 'maxLength', 'minItems', 'maxItems', 'pattern', 'default', '$schema')}
    if result.get('type') == 'object' or 'properties' in result:
        result['additionalProperties'] = False
        if strict:
            result['required'] = list(result.get('properties', {}))
    return result


def _images(paths, accepts):
    if paths and not accepts:
        raise ProviderError('This model has no verified image support in Kinema. Choose a model marked for images.')
    if len(paths) > 20:
        raise ProviderError('This request contains too many images for the API connection.')
    out, total = [], 0
    for p in paths:
        path = Path(p)
        mime = IMAGE_TYPES.get(path.suffix.lower())
        if not mime:
            raise ProviderError('Use PNG, JPEG, WebP or GIF images.')
        try:
            size = path.stat().st_size
            total += size
            if size > MAX_IMAGE_BYTES or total > 20_000_000:
                raise ProviderError('The images exceed this API connection’s upload limit. Use smaller images.')
            encoded = base64.b64encode(path.read_bytes()).decode('ascii')
        except OSError:
            raise ProviderError('One attached image is unavailable. Attach it again.') from None
        out.append((mime, encoded))
    return out


def _count(value):
    return value if type(value) is int and value >= 0 else 0


def _run(choice, prompt, *, schema_text=None, images=None, system=None, timeout=300, on_event=None, cancel=None):
    from .provider_connections import store
    selected = store()
    mid = choice.get('model', '')
    pid, _, model = mid.partition(':')
    cap = next((m for m in selected.models() if m['id'] == mid), None)
    if not cap:
        raise ProviderError('This model is not in the verified connection. Open Connections and verify it again.')
    if choice.get('effort') not in cap['efforts'] or choice.get('speed') != 'standard':
        raise ProviderError('This model does not support the selected effort or speed. Choose one of its listed options.')
    if cancel and cancel.is_set():
        raise ProviderError('Stopped. No provider request was sent.')
    key = selected.key(pid)
    pics = _images(images or [], cap['image_input'])
    try:
        original_schema = json.loads(schema_text) if schema_text else None
    except (ValueError, TypeError):
        raise ProviderError('The requested answer format is invalid.') from None
    if original_schema is not None and not isinstance(original_schema, dict):
        raise ProviderError('The requested answer format must be an object schema.')
    instruction = system or ''
    if original_schema:
        instruction += '\nReturn only JSON matching this schema. Do not use Markdown fences.\n' + json.dumps(original_schema)
    effort = choice['effort']
    maximum = cap['max_output_tokens']
    if pid == 'openai':
        content = [{'type': 'input_text', 'text': prompt}] + [
            {'type': 'input_image', 'image_url': f'data:{mime};base64,{data}'} for mime, data in pics]
        payload = {'model': model, 'input': [{'role': 'user', 'content': content}],
                   'instructions': instruction, 'max_output_tokens': maximum, 'store': False}
        if original_schema:
            payload['text'] = {'format': {'type': 'json_schema', 'name': 'kinema_reply', 'strict': True, 'schema': _schema(original_schema, True)}}
        response = _request(pid, '/responses', key, method='POST', payload=payload, timeout=timeout, cancel=cancel)
        if response.get('status') in ('incomplete', 'failed'):
            raise ProviderError('The provider did not finish the answer. Nothing was retried.')
        blocks = [b for o in response.get('output', []) if isinstance(o, dict) for b in o.get('content', []) if isinstance(b, dict)]
        if any(b.get('type') == 'refusal' for b in blocks):
            raise ProviderError('The selected model declined this request. Nothing was retried.')
        text = ''.join(b.get('text', '') for b in blocks if b.get('type') == 'output_text')
        raw_usage = response.get('usage') or {}
        usage = {'input_tokens': _count(raw_usage.get('input_tokens')), 'output_tokens': _count(raw_usage.get('output_tokens')),
                 'cached_input_tokens': _count((raw_usage.get('input_tokens_details') or {}).get('cached_tokens'))}
    elif pid == 'anthropic':
        content = [{'type': 'image', 'source': {'type': 'base64', 'media_type': mime, 'data': data}} for mime, data in pics]
        content.append({'type': 'text', 'text': prompt})
        payload = {'model': model, 'max_tokens': maximum, 'system': instruction,
                   'messages': [{'role': 'user', 'content': content}]}
        output = {}
        if effort != 'default':
            output['effort'] = effort
        if original_schema and cap['structured_output']:
            output['format'] = {'type': 'json_schema', 'schema': _schema(original_schema)}
        if output:
            payload['output_config'] = output
        response = _request(pid, '/messages', key, method='POST', payload=payload, timeout=timeout, cancel=cancel)
        if response.get('stop_reason') in ('refusal', 'max_tokens', 'model_context_window_exceeded'):
            raise ProviderError('The selected model declined or could not finish this answer. Nothing was retried.')
        text = ''.join(b.get('text', '') for b in response.get('content', []) if b.get('type') == 'text')
        u = response.get('usage') or {}
        cached = _count(u.get('cache_creation_input_tokens')) + _count(u.get('cache_read_input_tokens'))
        usage = {'input_tokens': _count(u.get('input_tokens')) + cached, 'output_tokens': _count(u.get('output_tokens')), 'cached_input_tokens': cached}
    elif pid == 'gemini':
        parts = [{'text': prompt}] + [{'inlineData': {'mimeType': mime, 'data': data}} for mime, data in pics]
        config = {'maxOutputTokens': maximum}
        if original_schema:
            config.update(responseMimeType='application/json')
            if cap['structured_output']:
                config['responseJsonSchema'] = _schema(original_schema)
        payload = {'contents': [{'role': 'user', 'parts': parts}], 'systemInstruction': {'parts': [{'text': instruction}]}, 'generationConfig': config}
        response = _request(pid, '/models/' + model + ':generateContent', key, method='POST', payload=payload, timeout=timeout, cancel=cancel)
        candidates = response.get('candidates') or []
        if not candidates or candidates[0].get('finishReason') not in (None, 'STOP'):
            raise ProviderError('The selected model declined or could not finish this answer. Nothing was retried.')
        text = ''.join(p.get('text', '') for p in candidates[0].get('content', {}).get('parts', []) if not p.get('thought'))
        u = response.get('usageMetadata') or {}
        usage = {'input_tokens': _count(u.get('promptTokenCount')), 'output_tokens': _count(u.get('candidatesTokenCount')) + _count(u.get('thoughtsTokenCount')),
                 'cached_input_tokens': _count(u.get('cachedContentTokenCount'))}
    else:
        content = [{'type': 'text', 'text': prompt}] + [
            {'type': 'image_url', 'image_url': {'url': f'data:{mime};base64,{data}'}} for mime, data in pics]
        payload = {'model': model, 'messages': [{'role': 'system', 'content': instruction}, {'role': 'user', 'content': content}], 'max_tokens': maximum, 'stream': False}
        if pid == 'kimi' and effort != 'default':
            payload['reasoning_effort'] = effort
        if pid == 'openrouter':
            payload['provider'] = {'require_parameters': True, 'allow_fallbacks': False}
        if original_schema:
            payload['response_format'] = ({'type': 'json_schema', 'json_schema': {'name': 'kinema_reply', 'strict': True, 'schema': _schema(original_schema, True)}}
                                          if pid == 'openrouter' else {'type': 'json_object'})
        response = _request(pid, '/chat/completions', key, method='POST', payload=payload, timeout=timeout, cancel=cancel)
        outputs = response.get('choices') or []
        if not outputs or outputs[0].get('finish_reason') not in (None, 'stop') or outputs[0].get('message', {}).get('refusal'):
            raise ProviderError('The selected model declined or could not finish this answer. Nothing was retried.')
        text = outputs[0].get('message', {}).get('content') or ''
        u = response.get('usage') or {}
        usage = {'input_tokens': _count(u.get('prompt_tokens')), 'output_tokens': _count(u.get('completion_tokens')),
                 'cached_input_tokens': _count((u.get('prompt_tokens_details') or {}).get('cached_tokens'))}
    if cancel and cancel.is_set():
        raise ProviderError('Stopped. The reply was discarded.')
    if not isinstance(text, str) or not text.strip():
        raise ProviderError('The selected model returned an empty answer.')
    if original_schema:
        try:
            value = json.loads(text)
            if not isinstance(value, dict):
                raise ValueError()
        except ValueError:
            raise ProviderError('The selected model did not return the requested JSON format. Nothing was retried.') from None
    return text.strip(), {'model': mid, 'provider': pid, 'usage': usage, 'delivery': 'complete'}


def run(choice, prompt, **kwargs):
    try:
        return _run(choice, prompt, **kwargs)
    except (KeyError, TypeError, AttributeError, IndexError):
        raise ProviderError('The provider returned an unexpected answer format. Nothing was retried.') from None
