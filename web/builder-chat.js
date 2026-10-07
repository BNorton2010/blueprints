/* Shared interaction rules for the Offer and Campaign conversations. */
(() => {
 const positions=new Map(),briefs=new Map();
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const $=id=>document.getElementById(id);
 const frame=fn=>(window.requestAnimationFrame||((f)=>setTimeout(f,0)))(fn);
 // iOS shrinks the visual viewport, not necessarily dvh, when its keyboard opens.
 // Keep the existing conversation/composer together; never clone or move the input.
 function keyboardViewport(){
  const viewport=window.visualViewport;if(!viewport)return;
  let surface=null,spacer=null,queued=false,baseline=viewport.height;
  const release=()=>{if(surface){surface.classList.remove('chat-keyboard-surface');surface.style.removeProperty('--chat-visible-top');surface.style.removeProperty('--chat-visible-height');}spacer?.remove();surface=null;spacer=null;};
  function update(){
   queued=false;
   const focused=document.activeElement;
   const editable=focused?.matches('textarea,input:not([type=button]):not([type=submit]),[contenteditable=true]');
   const mobile=window.matchMedia?.('(max-width: 1100px) and (pointer: coarse)').matches;
   if(!mobile||Math.abs((viewport.scale||1)-1)>.05){release();return;}
   if(!editable&&!surface)baseline=viewport.height;
   const keyboard=Math.max(baseline,window.innerHeight||0)-viewport.height>100;
   if(!keyboard){release();return;}
   const composer=focused?.closest('.chat-composer');
   const next=composer?.closest('.contextual-drawer,.builder-chat');
   if(next&&next!==surface){
    release();surface=next;
    if(!surface.matches('.contextual-drawer')){
     spacer=document.createElement('div');spacer.setAttribute('aria-hidden','true');
     spacer.style.height=surface.getBoundingClientRect().height+'px';surface.before(spacer);
    }
    surface.classList.add('chat-keyboard-surface');
   }
   if(surface&&(!surface.isConnected||surface.closest('[hidden]')||(!next&&!surface.contains(focused))))release();
   if(surface){
    surface.style.setProperty('--chat-visible-top',(viewport.offsetTop+8)+'px');
    surface.style.setProperty('--chat-visible-height',Math.max(0,viewport.height-20)+'px');
   }else if(editable){
    // Other app forms keep their normal layout; only reveal an obscured field.
    const rect=focused.getBoundingClientRect();
    if(rect.bottom>viewport.offsetTop+viewport.height-12||rect.top<viewport.offsetTop+12)focused.scrollIntoView({block:'center',behavior:'instant'});
   }
  }
  function schedule(){if(!queued){queued=true;frame(update);}}
  document.addEventListener('focusin',schedule);document.addEventListener('focusout',schedule);
  document.addEventListener('input',schedule);
  viewport.addEventListener('resize',schedule);viewport.addEventListener('scroll',schedule);
  window.addEventListener('resize',schedule);
  window.addEventListener('orientationchange',()=>{release();baseline=0;schedule();});
 }
 keyboardViewport();
 function remember(key,feed){if(!feed||feed.dataset.chatKey!==key)return;const old=positions.get(key);if(old)positions.set(key,{...old,top:feed.scrollTop||0});}
 function mount(key,feedId,jumpId,stamp,{force=false,empty=false}={}){
  const feed=$(feedId),jump=$(jumpId);if(!feed||!jump)return;
  const previous=positions.get(key),changed=previous?.stamp!==stamp,follow=force||!previous||previous.follow;feed.dataset.chatKey=key;
  positions.set(key,{top:previous?.top||0,follow,stamp});
  const latestTop=()=>{const messages=feed.querySelectorAll('.offer-message.assistant'),last=messages[messages.length-1];return stamp!=='sending'&&last&&typeof last.offsetTop==='number'?Math.max(0,last.offsetTop-feed.offsetTop-12):feed.scrollHeight;};
  const latest=()=>{feed.scrollTop=latestTop();positions.set(key,{top:feed.scrollTop,follow:true,stamp});jump.hidden=true;};
  jump.textContent=changed?'New response ↓':'Latest message ↓';jump.hidden=follow;
  jump.onclick=latest;
  feed.onscroll=()=>{const atLatest=feed.scrollTop>=Math.min(latestTop(),feed.scrollHeight-feed.clientHeight)-24;positions.set(key,{top:feed.scrollTop,follow:atLatest,stamp});jump.hidden=atLatest;};
  frame(()=>{if(!feed.isConnected)return;if(empty){feed.scrollTop=0;jump.hidden=true;}else if(follow)latest();else feed.scrollTop=previous.top;});
 }
 // Render a safe Markdown subset. Model HTML is always displayed as text.
 function markdown(value){
  const inline=value=>{
   const tokens=[];
   let text=esc(value).replace(/`([^`]+)`/g,(_,code)=>{tokens.push('<code>'+code+'</code>');return '\u0000'+(tokens.length-1)+'\u0000';});
   text=text.replace(/\[([^\]]+)\]\(([^\s)]+)\)/g,(_,label,url)=>{
    if(!/^(https?:\/\/|mailto:)/i.test(url))return label;
    tokens.push('<a href="'+url+'" target="_blank" rel="noopener noreferrer">'+label+'</a>');return '\u0000'+(tokens.length-1)+'\u0000';
   }).replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>').replace(/__(.+?)__/g,'<strong>$1</strong>').replace(/(^|[\s(])\*([^*\n]+)\*/g,'$1<em>$2</em>').replace(/(^|[\s(])_([^_\n]+)_/g,'$1<em>$2</em>').replace(/~~(.+?)~~/g,'<del>$1</del>');
   return text.replace(/\u0000(\d+)\u0000/g,(_,n)=>tokens[n]||'');
  };
  const lines=String(value??'').replace(/\u0000/g,'').replace(/\r\n?/g,'\n').split('\n'),out=[];let paragraph=[],list=null,code=null;
  const flush=()=>{if(paragraph.length){out.push('<p>'+paragraph.map(inline).join('<br>')+'</p>');paragraph=[];}if(list){out.push('</'+list+'>');list=null;}};
  for(const line of lines){
   if(/^\s*```/.test(line)){flush();if(code!==null){out.push('<pre><code>'+esc(code.join('\n'))+'</code></pre>');code=null;}else code=[];continue;}
   if(code!==null){code.push(line);continue;}
   const item=line.match(/^\s*(?:([-+*])|([0-9]+)[.)])\s+(.+)$/),heading=line.match(/^#{1,6}\s+(.+)$/);
   if(item){if(paragraph.length)flush();const type=item[2]?'ol':'ul';if(list!==type){flush();list=type;out.push('<'+type+(item[2]?' start="'+Number(item[2])+'"':'')+'>');}out.push('<li>'+inline(item[3])+'</li>');continue;}
   if(!line.trim()){flush();continue;}
   if(heading){flush();out.push('<h3>'+inline(heading[1])+'</h3>');continue;}
   if(/^>\s?/.test(line)){flush();out.push('<blockquote>'+inline(line.replace(/^>\s?/,''))+'</blockquote>');continue;}
   if(list)flush();paragraph.push(line);
  }
  flush();if(code!==null)out.push('<pre><code>'+esc(code.join('\n'))+'</code></pre>');
  return '<div class="chat-markdown">'+out.join('')+'</div>';
 }
 // Treat a click wholly outside a modal as Escape, preserving each modal's guards.
 let outsideDialog=null;
 function outside(event){const dialog=event.target;if(dialog?.tagName!=='DIALOG'||!dialog.open)return null;const r=dialog.getBoundingClientRect();return event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom?dialog:null;}
 document.addEventListener('pointerdown',event=>{outsideDialog=outside(event);});
 document.addEventListener('click',event=>{const dialog=outside(event);if(dialog&&dialog===outsideDialog){const cancel=new window.Event('cancel',{cancelable:true});if(dialog.dispatchEvent(cancel))dialog.close();}outsideDialog=null;});
 function message(m,text=m.text){
  const reference=m.source?.kind==='brain',label=reference?'Business Brain reference':m.role==='user'?'You':'Strategist';
  const content=m.role!=='user'?markdown(text):text.length>180?'<details class="chat-long-message"><summary>'+esc(text.slice(0,110).trim())+'… <span>View full '+(reference?'reference':'message')+'</span></summary><p>'+esc(text)+'</p></details>':'<p>'+esc(text)+'</p>';
  return '<article class="offer-message '+(m.role==='user'?'user':'assistant')+'"><span>'+label+'</span>'+content+'</article>';
 }
 // One pending assistant bubble per feed. Never persisted as a conversation message.
 function typing(feedId,on){
  const feed=$(feedId);if(!feed)return;
  const existing=feed.querySelector('.chat-typing');
  if(!on){existing?.remove();return;}
  if(existing){feed.append(existing);return;}
  const follow=feed.scrollHeight-feed.scrollTop-feed.clientHeight<80;
  const bubble=document.createElement('div');bubble.className='chat-typing';bubble.setAttribute('role','status');bubble.setAttribute('aria-live','polite');
  bubble.innerHTML='<span class="chat-typing-label">Assistant is responding</span><span class="chat-typing-dots" aria-hidden="true"><i></i><i></i><i></i></span>';
  feed.append(bubble);if(follow)frame(()=>{if(bubble.isConnected)feed.scrollTop=feed.scrollHeight;});
 }
 // Echo before any saving/provider work; authoritative rendering replaces this transient bubble.
 async function sending(feedId,text,task){
  const feed=$(feedId);let bubble;
  if(feed&&text){
   feed.querySelector('.vs-chat-empty')?.remove();
   feed.insertAdjacentHTML('beforeend',message({role:'user',text}));bubble=feed.lastElementChild;
   bubble.dataset.optimistic='true';typing(feedId,true);feed.scrollTop=feed.scrollHeight;
  }
  try{return await task();}finally{bubble?.remove();typing(feedId,false);}
 }
 async function responding(feedId,task,statusIds=[]){
  for(const id of statusIds)if($(id))$(id).hidden=true;
  typing(feedId,true);try{return await task();}finally{typing(feedId,false);}
 }
 function resizeInput(id){const input=$(id);if(!input)return;input.style.height='auto';input.style.height=Math.min(120,Math.max(52,input.scrollHeight||52))+'px';}
 function iconControls(id){
  const input=$(id),surface=input?.closest('.voice-composer'),actions=input?.closest('.chat-composer')?.querySelector('.chat-composer-actions');if(!surface||!actions)return;
  if(actions.parentElement!==surface)surface.append(actions);
  const svg=path=>'<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+path+'</svg>';
  const set=(button,label,path,kind)=>{if(!button)return;button.type='button';button.title=label;button.setAttribute('aria-label',label);button.classList.add('chat-icon-action',kind);button.innerHTML=svg(path);};
  set(actions.querySelector('.copy-button'),'Send message','<path d="M12 19V5m-6 6 6-6 6 6"/>','chat-send-icon');
  set(actions.querySelector('[data-offer-action="start-existing"]'),'Add reference material','<path d="M12 5v14M5 12h14"/>','chat-reference-icon');
  const mic=surface.querySelector('.inline-voice-host>button');if(mic){mic.classList.add('chat-mic-icon');mic.title=mic.getAttribute('aria-label')||'Record a message';}
  surface.classList.toggle('chat-has-reference',!!actions.querySelector('.chat-reference-icon'));
 }
 function composer(id,send){const input=$(id);if(!input)return;input.rows=1;input.title=window.matchMedia?.('(pointer: coarse)').matches?'Tap the arrow to send':'Enter to send · Shift + Enter for a new line';iconControls(id);input.addEventListener('input',()=>resizeInput(id));input.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing&&!window.matchMedia?.('(pointer: coarse)').matches){e.preventDefault();send();}});frame(()=>resizeInput(id));}
 function reveal(id,focus=false){frame(()=>{const el=$(id);if(!el)return;el.scrollIntoView({behavior:window.matchMedia?.('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:focus?'nearest':'start'});if(focus)el.focus({preventScroll:true});});}
 function highlight(key,root,values){const before=briefs.get(key);briefs.set(key,JSON.stringify(values));if(!before)return;const old=JSON.parse(before);root?.querySelectorAll('[data-brief-key]').forEach(el=>{const field=el.dataset.briefKey;if(JSON.stringify(old[field])!==JSON.stringify(values[field])){el.classList.add('chat-brief-updated');el.title='Updated from this conversation';}});}
 function composerMarkup({prefix,voiceHost,label='Your message'}){return '<form id="'+prefix+'Reply" class="chat-composer drawer-composer"><label class="chat-input-label" for="'+prefix+'Message">'+esc(label)+'</label><div class="voice-composer"><textarea class="drawer-message" id="'+prefix+'Message" rows="1" maxlength="6000" placeholder="Share your thoughts…"></textarea><div id="voiceHost-'+voiceHost+'" class="inline-voice-host"><button id="'+prefix+'Voice" type="button" aria-label="Record a message">'+($('voiceIdeasOpen')?.querySelector('svg')?.outerHTML||'')+'<span>Record</span></button></div><div class="chat-composer-actions"><button class="copy-button" id="'+prefix+'Send" type="submit">Send</button></div></div></form>';}
 function drawer({prefix,title='',subtitle='',label='Your message',voiceHost,footer=''}){
  const dialog=document.createElement('dialog');dialog.id=prefix+'Drawer';dialog.className='contextual-drawer';dialog.setAttribute('aria-labelledby',prefix+'DrawerTitle');
  dialog.innerHTML='<header><div><p class="eyebrow" id="'+prefix+'DrawerSubtitle">'+esc(subtitle)+'</p><h2 id="'+prefix+'DrawerTitle">'+esc(title)+'</h2></div><button id="'+prefix+'DrawerClose" class="idea-action" type="button">Close ×</button></header><p id="'+prefix+'DrawerError" class="offer-error" role="alert" hidden></p><p id="'+prefix+'DrawerProgress" class="offer-progress drawer-progress" role="status" hidden>Thinking…</p><div id="'+prefix+'DrawerBody" class="contextual-drawer-body"></div><footer id="'+prefix+'DrawerFooter" hidden>'+footer+composerMarkup({prefix,voiceHost,label})+'</footer>';
  document.body.append(dialog);return dialog;
 }
 function conversation(prefix,title,content,extraClass=''){
  return '<div id="'+prefix+'Conversation" class="drawer-chat builder-chat '+esc(extraClass)+'"><header class="chat-heading"><strong>'+esc(title)+'</strong></header><div id="'+prefix+'ChatFeed" class="chat-feed" role="log" aria-label="'+esc(title)+' conversation">'+content+'</div><button id="'+prefix+'Latest" class="idea-action chat-latest" type="button" hidden>Latest message ↓</button></div>';
 }
 function voiceActive(host){return !!$('voiceHost-'+host)?.contains($('voiceDialog'))&&!!window.Voice?.isActive();}
 function retireVoice(host){const dialog=$('voiceDialog');if(dialog&&$('voiceHost-'+host)?.contains(dialog)&&!window.Voice?.isActive()){window.Voice?.clear('ideas');$('voiceHost-ideas').append(dialog);}}
 window.BuilderChat={markdown,typing,sending,responding,remember,mount,message,composer,resizeInput,iconControls,reveal,highlight,composerMarkup,drawer,conversation,voiceActive,retireVoice};
})();
