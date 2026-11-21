"""Run after npm run build with Python Playwright, Chrome and Pillow installed.

python tests/map_drag.py
python tests/map_drag.py --reference path/to/previous/index.html
python tests/map_drag.py --check-timing
"""
import argparse
import asyncio
import base64
import json
import math
from io import BytesIO
from pathlib import Path

from PIL import Image, ImageChops, ImageStat
from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parents[1]
BUILD = ROOT / "dist/index.html"
KEY = "meridian-map-config"

# Observe actual visible canvas updates. The worker gate can deliver an old bitmap
# during the following gesture, independently of machine speed.
PROBE = """(() => {
  const p = window.probe = {sent:0, shown:0, received:0, textures:0, datasets:0,
    first:0, up:0, submittedAt:0, frames:[], measuring:false, hold:false};
  const proto = CanvasRenderingContext2D.prototype;
  const clear = proto.clearRect, draw = proto.drawImage, raf = window.requestAnimationFrame;
  let clears = 0;
  proto.clearRect = function(...args) {
    if (this.canvas.isConnected) clears++;
    return clear.apply(this,args);
  };
  proto.drawImage = function(...args) {
    if (this.canvas.isConnected && args[0] instanceof ImageBitmap) p.shown = p.received;
    return draw.apply(this,args);
  };
  window.requestAnimationFrame = cb => raf.call(window, ts => {
    const before = clears;
    cb(ts);
    if (before !== clears && p.measuring) p.frames.push([ts,performance.now()]);
  });
  document.addEventListener('pointermove', e => {
    if (p.measuring && e.buttons && !p.first) p.first=performance.now();
  }, true);
  document.addEventListener('pointerup', () => p.up=performance.now(), true);
  if (typeof Worker === 'undefined') return;
  window.Worker = class extends Worker {
    constructor(...args) {
      super(...args);
      this.addEventListener('message', e => {
        if (e.data.pixels) p.textures++;
        if (!e.data.bitmap) return;
        if (p.hold) {
          e.stopImmediatePropagation();
          p.release=()=>{p.hold=false; delete p.release; this.dispatchEvent(new MessageEvent('message',{data:e.data}));};
        } else p.received=e.data.id;
      });
    }
    postMessage(msg,...rest) {
      if (msg.kind==='full') {
        p.sent=msg.id; p.submittedAt=performance.now();
        p.datasets+=Object.keys(msg.data).length;
      }
      super.postMessage(msg,...rest);
    }
  }
})();"""
READY = "probe.datasets && probe.shown === probe.sent && probe.textures && !/Loading .+…|Failed to load/.test(document.querySelector('main').innerText)"


def preset(path):
    return json.loads((ROOT / path).read_text(encoding="utf-8-sig"))


CASES = {
    "10m": {"coastDetail": "10m", "waterDetail": "10m", "layers": {"countries": {"visible": True}}},
    "world": preset("scenarios/1939/preset.json"),
    "europe": preset("output/1939/1939-01-01-europe.json"),
    "africa": preset("output/1939/1939-01-01-africa.json"),
}


async def open_map(browser, config, build=BUILD, dpr=1, fallback=False):
    ctx = await browser.new_context(viewport={"width": 1600, "height": 1000}, device_scale_factor=dpr,
                                    accept_downloads=True, has_touch=True)
    async def offline(route):
        if "/world-atlas@2/" in route.request.url:
            await route.fulfill(path=ROOT / "node_modules/world-atlas" / route.request.url.split("/")[-1],
                                content_type="application/json", headers={"Access-Control-Allow-Origin": "*"})
        else:
            await route.abort()
    await ctx.route("http**://**/*", offline)
    init = "localStorage.setItem(" + json.dumps(KEY) + "," + json.dumps(json.dumps(config)) + ");"
    await ctx.add_init_script(init + ("window.OffscreenCanvas=undefined;" if fallback else "") + PROBE)
    page = await ctx.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    await page.goto(build.as_uri(), wait_until="domcontentloaded")
    await page.locator("canvas").wait_for()
    if build == BUILD and not fallback:
        await page.wait_for_function(READY, timeout=60000)
    else:
        await page.wait_for_function("document.querySelector('canvas').width>300 && !/Loading .+…|Failed to load/.test(document.querySelector('main').innerText)")
        await page.evaluate("() => new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))")
    return ctx, page, errors


async def state(page):
    # Flush the editor's own persistence handler. A fixed debounce timeout races a
    # synchronous high-DPI draw in the no-worker fallback.
    await page.evaluate("() => new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))")
    return await page.evaluate("()=>{window.dispatchEvent(new Event('pagehide'));return JSON.parse(localStorage.getItem('meridian-map-config')).view}")


async def screenshot(page):
    data = await page.locator("canvas").evaluate("c=>c.toDataURL().split(',')[1]")
    return Image.open(BytesIO(base64.b64decode(data))).convert("RGBA")


def difference(a, b):
    assert a.size == b.size
    return max(ImageStat.Stat(ImageChops.difference(a, b)).mean)


async def drag(page, ctx, name):
    box = await page.locator("canvas").bounding_box()
    x, y = box["x"] + .48*box["width"], box["y"] + .50*box["height"]
    cdp = await ctx.new_cdp_session(page)
    await page.mouse.move(x,y)
    await page.mouse.down()
    await page.evaluate("Object.assign(probe,{first:0,frames:[],measuring:true})")
    loop = asyncio.get_running_loop()
    start = loop.time()
    # Independent CDP input deadlines keep a slow frame from throttling the test driver.
    async def move(i):
        await asyncio.sleep(max(0, start+i/90-loop.time()))
        await cdp.send("Input.dispatchMouseEvent", {"type":"mouseMoved", "buttons":1, "button":"left",
                       "x":x+65*math.sin(i*.048), "y":y+22*math.sin(i*.064)})
    count = 180
    await asyncio.gather(*(move(i) for i in range(1,count+1)))
    end_x, end_y = x+65*math.sin(count*.048), y+22*math.sin(count*.064)
    await cdp.send("Input.dispatchMouseEvent", {"type":"mouseReleased","button":"left","buttons":0,"x":end_x,"y":end_y})
    await page.wait_for_function("probe.sent===probe.shown && probe.submittedAt >= probe.up")
    p = await page.evaluate("()=>{probe.measuring=false;return probe}")
    frames = p["frames"]
    assert len(frames) > 30, name
    gaps = sorted(b[0]-a[0] for a,b in zip(frames,frames[1:]))
    first = frames[0][1]-p["first"]
    p95 = gaps[math.ceil(.95*len(gaps))-1]
    print(f"{name:8} first {first:.1f} ms  p95 {p95:.1f} ms  release-to-submit {p['submittedAt']-p['up']:.1f} ms  ({len(frames)} frames)", flush=True)
    return first, p95


async def continuous_input(page):
    """Measure steady drawing with a 90 Hz page-local input clock, independent of CDP transport."""
    box = await page.locator("canvas").bounding_box()
    x,y = box["x"]+box["width"]/2,box["y"]+box["height"]/2
    await page.mouse.move(x,y)
    await page.mouse.down()
    first, frames = await page.evaluate("""([x,y])=>new Promise(resolve=>{
      Object.assign(probe,{measuring:true,first:0,frames:[]});
      const canvas=document.querySelector('canvas'), start=performance.now();
      const timer=setInterval(()=>{
        const t=performance.now()-start;
        canvas.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,pointerId:1,
          pointerType:'mouse',buttons:1,isPrimary:true,clientX:x+65*Math.sin(t*.00432),clientY:y+22*Math.sin(t*.00576)}));
        if(t>=2500) {
          clearInterval(timer);
          requestAnimationFrame(()=>{probe.measuring=false;resolve([probe.first,probe.frames])});
        }
      },1000/90);
    })""",[x,y])
    await page.mouse.up()
    await page.wait_for_function(READY)
    gaps = sorted(b[0]-a[0] for a,b in zip(frames,frames[1:]))
    latency = frames[0][1]-first
    p95 = gaps[math.ceil(.95*len(gaps))-1]
    print(f"         continuous input     first {latency:.1f} ms  p95 {p95:.1f} ms",flush=True)
    assert latency <= 50 and round(p95,1) <= 33.4, (latency,p95)


async def stale_frame(page):
    original = await state(page)
    box = await page.locator("canvas").bounding_box()
    x, y = box["x"]+box["width"]*.5, box["y"]+box["height"]*.5
    await page.mouse.move(x,y)
    await page.mouse.down()
    await page.mouse.move(x+60,y+15,steps=4)
    await page.evaluate("probe.hold=true")
    await page.mouse.up()
    await page.wait_for_function("!!probe.release")
    after_first = await state(page)
    assert after_first != original
    await page.mouse.down()
    await page.mouse.move(x-15,y-20,steps=4)
    assert await page.evaluate("()=>{const last=probe.shown; probe.release(); return probe.shown===last}")
    await page.mouse.up()
    await page.wait_for_function(READY)
    final = await state(page)
    assert final != after_first
    for expected, keys in [(after_first,"Control+z"), (original,"Control+z"), (after_first,"Control+y"), (final,"Control+y")]:
        await page.keyboard.press(keys)
        assert await state(page) == expected, keys


async def exported(page, label):
    async with page.expect_download(timeout=90000) as event:
        await page.get_by_role("button", name=label, exact=True).click()
    return (await (await event.value).path()).read_bytes()


async def compare(browser, name, config, previous, dpr):
    before_ctx, before, errors0 = await open_map(browser, config, previous, dpr)
    after_ctx, after, errors1 = await open_map(browser, config, dpr=dpr)
    diff = difference(await screenshot(before), await screenshot(after))
    assert diff < 2, (name, "static", diff)
    for page in (before, after):
        await page.get_by_role("banner").get_by_role("button",name="Export",exact=True).click()
    old, new = [await exported(p,"Download SVG (vector)") for p in (before,after)]
    assert old == new, (name,"SVG")
    old, new = [Image.open(BytesIO(await exported(p,"Download PNG"))).convert("RGBA") for p in (before,after)]
    assert difference(old,new) == 0, (name,"PNG")
    print(f"{name:8} static mean channel difference {diff:.3f}/255, identical PNG pixels and SVG",flush=True)
    assert not errors0+errors1, errors0+errors1
    await before_ctx.close()
    await after_ctx.close()


async def gesture_edges(browser):
    from copy import deepcopy
    config = deepcopy(CASES["world"])
    config["scenario"]["revision"] = 1
    # The original atlas gets water/cities from external sources, so isolate its
    # bundled political layers for the offline, high-DPI compatibility test.
    for k in ["rivers","lakes","cities","railways"]:
        config["layers"][k]["visible"] = False
    config["view"].update(projection="orthographic",lon=179,lat=3,zoom=1.2)
    ctx,page,errors = await open_map(browser,config,dpr=2)
    initial = await state(page)
    box = await page.locator("canvas").bounding_box()
    x,y = box["x"]+box["width"]/2,box["y"]+box["height"]/2
    cdp = await ctx.new_cdp_session(page)
    async def touch(kind,coords):
        await cdp.send("Input.dispatchTouchEvent", {"type":kind,"touchPoints":[
            {"x":px,"y":py,"id":i+1} for i,(px,py) in enumerate(coords)]})
    await touch("touchStart",[(x-48,y),(x+48,y)])
    await touch("touchMove",[(x-75,y-12),(x+75,y+12)])
    await touch("touchEnd",[])
    await page.wait_for_function(READY)
    pinched = await state(page)
    assert pinched["zoom"] > initial["zoom"] and abs(pinched["angle"])>2
    assert await page.locator("canvas").evaluate("c=>c.width===c.clientWidth*2")
    await page.keyboard.press("Control+z")
    assert await state(page) == initial

    # Cross the date line while the globe's far hemisphere is clipped.
    await page.mouse.move(x,y)
    await page.mouse.down()
    await page.mouse.move(x-65,y,steps=10)
    await page.wait_for_timeout(90)
    preview = await screenshot(page)
    await page.mouse.up()
    await page.wait_for_function(READY)
    precise = await screenshot(page)
    resized = precise.resize(preview.size, Image.Resampling.LANCZOS)
    assert (await state(page))["lon"] < 0
    assert difference(preview,resized)<18
    assert preview.getpixel((0,0)) == resized.getpixel((0,0))
    await page.mouse.wheel(0,-100)
    await page.wait_for_timeout(500)
    assert (await state(page))["zoom"] > initial["zoom"]
    assert not errors,errors
    await ctx.close()

    ctx,page,errors = await open_map(browser,CASES["10m"],dpr=2,fallback=True)
    initial = await state(page)
    await page.mouse.move(x,y)
    await page.mouse.down()
    await page.mouse.move(x+40,y+10,steps=4)
    await page.mouse.up()
    assert await state(page)!=initial
    assert await page.locator("canvas").evaluate("c=>c.width===c.clientWidth*2")
    await page.keyboard.press("Control+z")
    assert await state(page)==initial
    assert not errors,errors
    await ctx.close()
    print("Offline revision 1, globe/date line, pinch, wheel, DPR 2 and main-thread fallback passed.",flush=True)


async def main(args):
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(channel="chrome")
        for name, config in CASES.items():
            ctx, page, errors = await open_map(browser,config,dpr=args.dpr)
            initial = await state(page)
            await drag(page,ctx,name)
            final_config = await page.evaluate("()=>{window.dispatchEvent(new Event('pagehide'));return JSON.parse(localStorage.getItem('meridian-map-config'))}")
            await page.keyboard.press("Control+z")
            assert await state(page) == initial
            if args.check_timing:
                await continuous_input(page)
            if name == "world":
                await stale_frame(page)
            assert not errors, errors
            await ctx.close()
            if args.reference:
                await compare(browser,name,final_config,args.reference.resolve(),args.dpr)
        await gesture_edges(browser)
        await browser.close()

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--reference",type=Path)
    parser.add_argument("--check-timing", action="store_true", help="also enforce the 50 ms / 33.4 ms steady-input targets on a reference machine")
    parser.add_argument("--dpr",type=int,default=1)
    asyncio.run(main(parser.parse_args()))
