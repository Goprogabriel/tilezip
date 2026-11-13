"""Load the real local app into an isolated about:blank test document.
Optional harness for locked-down browser test environments. It embeds local
assets and preserves the app's ES module graph. Production CSP is unchanged.
"""
from pathlib import Path
import re, base64
ROOT=Path(__file__).resolve().parents[1]

def load_app(page,root=ROOT):
    html=(root/'index.html').read_text()
    html=re.sub(r'<meta http-equiv="Content-Security-Policy"[^>]*>','',html)
    html=re.sub(r'<script type="module"[^>]*></script>','',html)
    html=re.sub(r'<link rel="(?:stylesheet|icon)"[^>]*>','',html)
    page.set_content(html,wait_until='domcontentloaded')
    page.add_style_tag(content=(root/'src/styles.css').read_text())
    files={str(p.relative_to(root)):p.read_text() for p in (root/'src').rglob('*.js')}
    image='data:image/jpeg;base64,'+base64.b64encode((root/'assets/desert-study.jpg').read_bytes()).decode()
    files['src/config.js']=files['src/config.js'].replace("new URL('../assets/desert-study.jpg', import.meta.url).href",repr(image))
    page.evaluate('''async (files) => {
      const urls = {};
      function resolve(from, rel) {
        const parts=from.split('/'); parts.pop();
        for (const p of rel.split('/')) { if(p==='..') parts.pop(); else if(p!=='.') parts.push(p); }
        return parts.join('/');
      }
      function build(name) {
        if(urls[name]) return urls[name];
        const code=files[name].replace(/from\\s+['"](\\.[^'"]+)['"]/g, (all,spec) => `from '${build(resolve(name,spec))}'`);
        urls[name]=URL.createObjectURL(new Blob([code],{type:'text/javascript'}));
        return urls[name];
      }
      await import(build('src/app.js'));
      window.__testModuleURLs = urls;
    }''',files)
    page.wait_for_selector('.slice-item canvas')
    page.wait_for_function("!document.getElementById('download-button').disabled")
    page.wait_for_timeout(450)
