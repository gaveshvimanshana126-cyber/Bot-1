module.exports = `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>MOVIEMANIA LK Bot - Pair</title>
<style>
body{font-family:system-ui,sans-serif;background:#0f172a;color:#e2e8f0;display:flex;justify-content:center;padding:24px}
.box{max-width:380px;width:100%;background:#1e293b;border-radius:16px;padding:24px;text-align:center}
input,button{width:100%;padding:14px;border-radius:10px;border:0;font-size:16px;margin-top:12px;box-sizing:border-box}
button{background:#22c55e;color:#fff;font-weight:700}
#code{font-size:34px;letter-spacing:4px;font-weight:800;margin-top:18px;color:#facc15}
small{color:#94a3b8}
</style></head><body><div class="box">
<h2>🎬 MOVIEMANIA LK Bot</h2>
<div id="form">
<small>Number eka country code ekka danna (+ nethuwa)<br>e.g. 94771234567</small>
<input id="num" type="tel" placeholder="94771234567">
<button onclick="pair()">Get Pair Code</button>
<div id="code"></div>
<small id="msg"></small>
</div>
<script>
const $=id=>document.getElementById(id);
fetch('/status').then(r=>r.json()).then(s=>{if(s.linked){$('form').innerHTML='<h3>✅ Bot linked & running</h3>'}});
async function pair(){
  $('code').textContent='';$('msg').textContent='Please wait...';
  try{
    const r=await fetch('/pair?number='+encodeURIComponent($('num').value));
    const d=await r.json();
    if(d.code){$('code').textContent=d.code;$('msg').textContent='WhatsApp > Linked devices > Link a device > Link with phone number instead > code eka gahanna';
      const t=setInterval(async()=>{const s=await (await fetch('/status')).json();if(s.linked){clearInterval(t);$('form').innerHTML='<h3>✅ Bot linked & running</h3>'}},3000);}
    else $('msg').textContent=d.error||'Error';
  }catch(e){$('msg').textContent=e.message}
}
</script></div></body></html>`;
