/* Capture PCM continuously; the output stays silent. */
class PanelDictationCapture extends AudioWorkletProcessor {
  constructor(){super();this.samples=new Float32Array(2048);this.count=0;this.port.onmessage=e=>{if(e.data==='flush')this.flush();};}
  flush(){if(this.count){const data=this.samples.slice(0,this.count);this.port.postMessage(data,[data.buffer]);this.count=0;}this.port.postMessage('flushed');}
  process(inputs){const channel=inputs[0]?.[0];if(channel)for(const value of channel){this.samples[this.count++]=value;if(this.count===this.samples.length){const data=this.samples;this.port.postMessage(data,[data.buffer]);this.samples=new Float32Array(2048);this.count=0;}}return true;}
}
registerProcessor('panel-dictation-capture',PanelDictationCapture);
