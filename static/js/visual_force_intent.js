/* Force visibility is a presentation choice, independent of camera and playback.
   Practice reveals are exposure only; callbacks own persistence, never grading. */
export function createForceIntent({intent='learn',onHelpReveal}={}) {
  intent=['practice','learn','library'].includes(intent)?intent:'learn';
  let on=intent!=='practice',revealed=false;
  return {
    get intent(){return intent;},get on(){return on;},get revealed(){return revealed;},
    get label(){return on?'Forces':intent==='practice'&&!revealed?'Reveal forces':'Show forces';},
    set(value,{explicit=false}={}){
      on=!!value;
      if(on&&explicit&&intent==='practice'&&!revealed){revealed=true;onHelpReveal?.({kind:'forces',assisted:true,intent});}
      return on;
    },
    reset(){on=intent!=='practice';return on;},
  };
}
