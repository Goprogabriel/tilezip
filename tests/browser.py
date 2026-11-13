"""Optional end-to-end checks: python tests/browser.py [--embedded].
Requires Playwright for Python and Pillow, not needed to run or deploy TileZip.
Default: start `npm run dev` first. --embedded loads the real modules without HTTP.
"""
from pathlib import Path
from io import BytesIO
import argparse, base64, json, shutil, tempfile, zipfile
from PIL import Image, ImageChops
from playwright.sync_api import sync_playwright
from offline_browser import load_app

ROOT=Path(__file__).resolve().parents[1]
parser=argparse.ArgumentParser()
parser.add_argument('--embedded', action='store_true')
parser.add_argument('--url', default='http://127.0.0.1:4173/')
parser.add_argument('--report', default='')
args=parser.parse_args()
passed=[]
def check(condition, name):
    assert condition, name
    passed.append(name)
    print('PASS',name,flush=True)

def ready(page):
    page.wait_for_function("!document.getElementById('editor-fields').disabled")
    page.wait_for_timeout(120)

def download(page, path):
    if args.embedded:
        page.locator('#download-button').click()
        page.wait_for_function("!document.getElementById('download-again').hidden && !document.getElementById('download-button').disabled", timeout=30000)
        encoded=page.evaluate("""async () => {
          const blob=await (await fetch(document.getElementById('download-again').href)).blob();
          return await new Promise(resolve=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result.split(',')[1]);reader.readAsDataURL(blob);});
        }""")
        path.write_bytes(base64.b64decode(encoded))
    else:
        with page.expect_download(timeout=30000) as dl:
            page.locator('#download-button').click()
        dl.value.save_as(path)
    ready(page)
    with zipfile.ZipFile(path) as z:
        assert z.testzip() is None
        return [(n,Image.open(BytesIO(z.read(n))).copy()) for n in z.namelist()]

with tempfile.TemporaryDirectory() as tmp, sync_playwright() as p:
    tmp=Path(tmp)
    chromium=shutil.which('chromium') or shutil.which('google-chrome')
    browser=p.chromium.launch(executable_path=chromium, headless=True, args=['--no-sandbox'])
    page=browser.new_page(viewport={'width':1440,'height':1080},device_scale_factor=1,accept_downloads=True)
    page.set_default_timeout(10000)
    errors=[]
    page.on('pageerror',lambda error: errors.append(str(error)))
    if args.embedded: load_app(page)
    else:
        page.goto(args.url,wait_until='networkidle')
        page.wait_for_selector('.slice-item canvas')
        ready(page)
    check(page.locator('.slice-item').count()==12,'demo shows 12 true vertical slices')
    check(page.locator('#download-button').is_enabled(),'demo can be exported immediately')
    page.locator('#scroll-next').click()
    page.wait_for_timeout(500)
    check(page.locator('#preview-scroller').evaluate('(e)=>e.scrollLeft')>0,'right arrow scrolls the carousel')
    page.locator('#preview-scroller').focus()
    page.keyboard.press('Home'); page.wait_for_timeout(450)
    check(page.locator('#preview-scroller').evaluate('(e)=>e.scrollLeft')==0,'keyboard Home returns to the first slice')
    box=page.locator('#preview-scroller').bounding_box()
    page.mouse.move(box['x']+400,box['y']+150)
    page.mouse.down();page.mouse.move(box['x']+160,box['y']+150,steps=8);page.mouse.up()
    check(page.locator('#preview-scroller').evaluate('(e)=>e.scrollLeft')>100,'mouse drag scrolls without distorting tiles')
    page.locator('[data-view="original"]').click()
    check(page.locator('#original-image').is_visible() and not page.locator('#preview-scroller').is_visible(),'original preview toggle works')
    page.locator('[data-view="carousel"]').click()
    page.locator('#message-input').fill('HELLO WORLD')
    page.wait_for_timeout(150)
    check(page.locator('.slice-item').count()==11 and page.locator('#character-count').inner_text()=='11/11','text matching includes the space')
    page.locator('[data-count="4"]').click()
    check(page.locator('#download-button').is_disabled() and page.locator('#message-feedback').is_visible(),'overflowing text blocks export instead of silently clipping')
    check(page.locator('#message-input').input_value()=='HELLO WORLD','changing count never deletes the message')
    page.locator('#match-text').check();page.wait_for_timeout(100)
    check(page.locator('#slice-count').input_value()=='11','matching fixes an overflowing message')
    page.locator('#message-input').fill('A'*21)
    check(page.locator('#download-button').is_disabled(),'messages above the 20-slice limit are rejected')
    page.locator('#message-input').fill('Æ🇩🇰👨‍👩‍👧‍👦');page.wait_for_timeout(100)
    check(page.locator('#slice-count').input_value()=='3','Danish letters, flags and family emoji count as single characters')
    page.locator('#text-enabled').uncheck()
    check(page.locator('#text-controls').is_hidden(),'text overlay can be completely disabled')

    # Odd width, deliberate colored pixels: join exported PNGs and compare byte-for-byte.
    source=Image.new('RGB',(1001,311))
    source.putdata([((x*7+y*3)%256,(x+y*11)%256,(x*3+y*7)%256) for y in range(311) for x in range(1001)])
    source_path=tmp/'pixel-accurate.png';source.save(source_path)
    page.locator('#file-input').set_input_files(source_path);ready(page)
    page.locator('[data-count="20"]').click();page.wait_for_timeout(100)
    tiles=download(page,tmp/'lossless.zip')
    check([n for n,_ in tiles]==[f'{i:02}.png' for i in range(1,21)],'ZIP filenames are 01.png through 20.png, in order')
    check([im.width for _,im in tiles]==[50]*19+[51],'odd-width remainder lands in the last slice without missing pixels')
    combined=Image.new('RGB',source.size)
    offset=0
    for _,im in tiles: combined.paste(im.convert('RGB'),(offset,0));offset+=im.width
    check(ImageChops.difference(source,combined).getbbox() is None,'PNG strips reconstruct the source with pixel-perfect equality')
    check(page.locator('#download-again').is_visible(),'persistent download link is available after ZIP creation')

    page.locator('#text-enabled').check()
    page.locator('#message-input').fill('A B')
    page.locator('#match-text').check();page.wait_for_timeout(150)
    text_tiles=download(page,tmp/'with-text.zip')
    bounds=[0,333,667,1001]
    diffs=[ImageChops.difference(im.convert('RGB'),source.crop((bounds[i],0,bounds[i+1],311))).getbbox() for i,(_,im) in enumerate(text_tiles)]
    check(diffs[0] is not None and diffs[1] is None and diffs[2] is not None,'characters are burned into exports; a space stays exactly unchanged')
    page.locator('#text-style-details summary').click()
    page.locator('#font-style').select_option('bold')
    page.locator('[data-position="bottom"]').click()
    page.locator('[data-color="#d7f59b"]').click()
    check(page.locator('[data-position="bottom"]').get_attribute('aria-pressed')=='true','font, color and position controls respond')
    page.locator('#text-style-details summary').click()
    page.locator('#text-enabled').uncheck()
    for fmt in ['jpg','webp']:
        page.locator(f'[data-format="{fmt}"]').click()
        exported=download(page,tmp/f'{fmt}.zip')
        check(len(exported)==3 and all(n.endswith('.'+fmt) for n,_ in exported),f'{fmt.upper()} export produces correctly typed, decodable image files')
    page.locator('[data-format="png"]').click()

    # Transparent inputs preserve alpha in PNG; JPEG explicitly fills white.
    alpha=Image.new('RGBA',(101,80),(50,100,150,0))
    for y in range(20,60):
        for x in range(20,80): alpha.putpixel((x,y),(10,20,30,255))
    alpha_path=tmp/'transparent.png';alpha.save(alpha_path)
    page.locator('#file-input').set_input_files(alpha_path);ready(page)
    page.locator('[data-count="4"]').click()
    alpha_tiles=download(page,tmp/'alpha.zip')
    check(alpha_tiles[0][1].getpixel((0,0))[3]==0,'PNG preserves transparent pixels')
    page.locator('[data-format="jpg"]').click()
    white_tiles=download(page,tmp/'white.zip')
    check(min(white_tiles[0][1].convert('RGB').getpixel((0,0)))>250,'JPEG transparency is flattened onto white, not black')

    old_dimension=page.locator('#image-dimensions').inner_text()
    invalid=tmp/'fake.png';invalid.write_text('<svg onload="alert(1)"></svg>')
    page.locator('#file-input').set_input_files(invalid);ready(page)
    check(page.locator('#notice').get_attribute('class')=='notice error','a disguised SVG is rejected by image signature')
    check(page.locator('#image-dimensions').inner_text()==old_dimension,'bad uploads leave the previous image intact')
    corrupt=tmp/'corrupt.png';corrupt.write_bytes(bytes([137,80,78,71,13,10,26,10])+b'bad')
    page.locator('#file-input').set_input_files(corrupt);ready(page)
    check('could not be opened' in page.locator('#notice-text').inner_text(),'corrupted images report a useful decode error')

    # Browsers rotate this JPEG based on EXIF orientation 6.
    rotated=Image.new('RGB',(120,80),'orange');exif=Image.Exif();exif[274]=6
    rotate_path=tmp/'oriented.jpg';rotated.save(rotate_path,exif=exif)
    page.locator('#file-input').set_input_files(rotate_path);ready(page)
    check(page.locator('#image-dimensions').inner_text()=='80 × 120','phone-photo EXIF orientation is respected')

    # File paste and drop do not need clipboard permissions or a network upload.
    b64=base64.b64encode(source_path.read_bytes()).decode()
    for event in ['paste','drop']:
        page.evaluate('''({b64,event})=>{
          const bytes=Uint8Array.from(atob(b64),c=>c.charCodeAt(0));
          const transfer=new DataTransfer();
          transfer.items.add(new File([bytes],event+'.png',{type:'image/png'}));
          if(event==='paste') document.dispatchEvent(new ClipboardEvent('paste',{clipboardData:transfer,bubbles:true,cancelable:true}));
          else window.dispatchEvent(new DragEvent('drop',{dataTransfer:transfer,bubbles:true,cancelable:true}));
        }''',{'b64':b64,'event':event})
        ready(page)
        check(page.locator('#source-name').inner_text()==event+'.png',f'image {event} loads the local file')

    page.locator('#reset-button').click();ready(page)
    check(page.locator('#message-input').input_value()=='STAY CURIOUS' and page.locator('#slice-count').input_value()=='12','reset restores the sample and all original settings')
    page.locator('[data-count="20"]').click()
    page.locator('#download-button').click()
    page.locator('#cancel-export').click()
    page.wait_for_function("!document.getElementById('download-button').disabled")
    check('cancelled' in page.locator('#notice-text').inner_text(),'export cancellation restores an editable app')
    page.locator('#reset-button').click();ready(page)
    page.locator('#dismiss-notice').click() if page.locator('#dismiss-notice').is_visible() else None

    for width in [320,390,768,1024,1440]:
        page.set_viewport_size({'width':width,'height':900});page.wait_for_timeout(100)
        check(page.evaluate('document.documentElement.scrollWidth <= innerWidth'),f'no page-level horizontal overflow at {width}px')
    page.emulate_media(reduced_motion='reduce')
    check(page.locator('.slice-item').first.evaluate('(e)=>getComputedStyle(e).animationName')=='none','reduced-motion preference disables decorative animation')
    check(not errors,'no uncaught JavaScript errors in the browser')
    browser.close()

report={'checks_passed':len(passed),'checks':passed,'browser':'Chromium','mode':'embedded local ES modules' if args.embedded else 'HTTP static server'}
if args.report: Path(args.report).write_text(json.dumps(report,indent=2))
print(f'\n{len(passed)} browser checks passed.')
