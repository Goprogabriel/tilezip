from playwright.sync_api import sync_playwright
from PIL import Image
from pathlib import Path
from io import BytesIO
import sys, argparse, shutil
root=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(root/'tests'))
from offline_browser import load_app
parser=argparse.ArgumentParser()
parser.add_argument('--embedded',action='store_true')
parser.add_argument('--url',default='http://127.0.0.1:4173/')
args=parser.parse_args()
frames=[]; durations=[]
with sync_playwright() as p:
    b=p.chromium.launch(executable_path=shutil.which('chromium') or shutil.which('google-chrome'),headless=True,args=['--no-sandbox'])
    page=b.new_page(viewport={'width':1440,'height':1320},device_scale_factor=1)
    if args.embedded: load_app(page,root)
    else:
        page.goto(args.url,wait_until='networkidle')
        page.wait_for_selector('.slice-item canvas')
        page.wait_for_timeout(450)
    page.mouse.move(1410,1050)
    page.screenshot(path=str(root/'docs/screenshot.png'),full_page=True)
    def frame(duration=120):
        im=Image.open(BytesIO(page.screenshot(full_page=False))).convert('RGB').resize((1000,917),Image.Resampling.LANCZOS)
        frames.append(im);durations.append(duration)
    frame(1500)
    maximum=page.locator('#preview-scroller').evaluate('(e)=>e.scrollWidth-e.clientWidth')
    for n in range(1,11):
        page.locator('#preview-scroller').evaluate('(e,x)=>e.scrollLeft=x',maximum*n/10)
        page.wait_for_timeout(45);frame(100)
    frame(800)
    page.locator('#message-input').fill('MAKE SOME NOISE')
    page.locator('#preview-scroller').evaluate('(e)=>e.scrollLeft=0')
    page.wait_for_timeout(400)
    page.mouse.move(1410,1050);frame(1500)
    maximum=page.locator('#preview-scroller').evaluate('(e)=>e.scrollWidth-e.clientWidth')
    for n in range(1,13):
        page.locator('#preview-scroller').evaluate('(e,x)=>e.scrollLeft=x',maximum*n/12)
        page.wait_for_timeout(40);frame(100)
    frame(1000)
    page.locator('[data-view="overview"]').click()
    page.mouse.move(1410,1050);page.wait_for_timeout(200);frame(1800)
    page.screenshot(path=str(root/'docs/overview.png'),full_page=True)
    page.locator('[data-view="original"]').click()
    page.mouse.move(1410,1050);page.wait_for_timeout(200);frame(1400)
    page.locator('#reset-button').click()
    page.wait_for_timeout(500);page.mouse.move(1410,1050);frame(800)
    desktop=Image.open(root/'docs/screenshot.png').convert('RGB')
    desktop.crop((0,0,1440,756)).resize((1200,630),Image.Resampling.LANCZOS).save(root/'assets/social-card.png')
    page.set_viewport_size({'width':390,'height':844});page.wait_for_timeout(250)
    page.screenshot(path=str(root/'docs/mobile.png'),full_page=True)
    b.close()
# A single palette keeps the recorded interface stable between frames.
mosaic=Image.new('RGB',(360*5,270*3))
for n,im in enumerate(frames[::max(1,len(frames)//15)][:15]):
    mosaic.paste(im.resize((360,270)),((n%5)*360,(n//5)*270))
palette=mosaic.quantize(colors=240,method=Image.Quantize.MEDIANCUT)
quantized=[im.quantize(palette=palette,dither=Image.Dither.NONE) for im in frames]
quantized[0].save(root/'docs/demo.gif',save_all=True,append_images=quantized[1:],duration=durations,loop=0,optimize=True,disposal=1)
print('Captured',len(frames),'frames;',sum(durations)/1000,'seconds; GIF size', (root/'docs/demo.gif').stat().st_size)
