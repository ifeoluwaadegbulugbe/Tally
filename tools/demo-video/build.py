"""Build the Tally demo video and gallery images from captured screenshots and narration.

Usage: python build.py <video_dir> <out_dir>
"""
import json, subprocess, sys, wave
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageFilter

V, OUT = Path(sys.argv[1]), Path(sys.argv[2])
OUT.mkdir(parents=True, exist_ok=True)
W, H = 1920, 1080
BRAND, CANVAS, INK, MUTED = (31, 122, 77), (250, 250, 247), (27, 31, 29), (94, 102, 95)
BAND = 132  # caption band height

def font(sz, bold=False):
    for f in (['segoeuib.ttf', 'arialbd.ttf'] if bold else ['segoeui.ttf', 'arial.ttf']):
        try:
            return ImageFont.truetype(f, sz)
        except OSError:
            pass
    return ImageFont.load_default()

def mark(d, x, y, s, c, w):
    for i in range(4):
        X = x + s * (0.2 + 0.2 * i)
        d.line([(X, y + s * .16), (X, y + s * .84)], fill=c, width=w)
    d.line([(x + s * .08, y + s * .72), (x + s * .96, y + s * .28)], fill=c, width=w)

def logo(d, x, y, size):
    d.rounded_rectangle([x, y, x + size, y + size], radius=size // 5, fill=BRAND)
    mark(d, x + size * .15, y + size * .15, size * .7, (255, 255, 255), max(4, size // 14))

def centre(d, text, y, f, c, width=W):
    d.text(((width - d.textlength(text, font=f)) / 2, y), text, font=f, fill=c)

def card(lines):
    im = Image.new('RGB', (W, H), CANVAS)
    d = ImageDraw.Draw(im)
    logo(d, (W - 260) // 2, 200, 260)
    y = 520
    for text, f, c in lines:
        centre(d, text, y, f, c)
        y += f.size + 40
    return im

def mcp_card():
    im = Image.new('RGB', (W, H), (24, 26, 27))
    d = ImageDraw.Draw(im)
    mono = font(40)
    for fname in ('consola.ttf', 'cour.ttf'):
        try:
            mono = ImageFont.truetype(fname, 38)
            break
        except OSError:
            pass
    d.text((140, 120), 'Claude  >  MCP server "tally"  (mcp.atlassian.com/forge/f43c90aa-...)', font=mono, fill=(160, 200, 170))
    d.text((140, 190), 'Connected. 7 tools:', font=mono, fill=(230, 230, 230))
    tools = ['find-commitments', 'get-account-health', 'get-commitment-details', 'identify-at-risk-commitments',
             'explain-risk', 'draft-customer-update', 'propose-candidate']
    for i, t in enumerate(tools):
        d.text((200, 270 + i * 70), f'-  {t}', font=mono, fill=(120, 200, 255))
    d.text((140, 800), 'Runs with the signed-in user\'s permissions. Writes only propose to the inbox.', font=mono, fill=(180, 180, 180))
    return im

def shot_frame(path, caption):
    src = Image.open(path).convert('RGB')
    area_h = H - BAND
    scale = min(W / src.width, area_h / src.height)
    shot = src.resize((int(src.width * scale), int(src.height * scale)), Image.LANCZOS)
    shot = shot.filter(ImageFilter.UnsharpMask(radius=1.2, percent=60, threshold=2))
    im = Image.new('RGB', (W, H), CANVAS)
    im.paste(shot, ((W - shot.width) // 2, (area_h - shot.height) // 2))
    d = ImageDraw.Draw(im)
    d.rectangle([0, H - BAND, W, H], fill=BRAND)
    logo(d, 40, H - BAND + 26, 80)
    f = font(46, True)
    while d.textlength(caption, font=f) > W - 220 and f.size > 30:
        f = font(f.size - 2, True)
    d.text((150, H - BAND + (BAND - f.size) / 2 - 6), caption, font=f, fill=(255, 255, 255))
    return im

def wav_seconds(p):
    with wave.open(str(p)) as w:
        return w.getnframes() / w.getframerate()

beats = json.loads((V / 'beats.json').read_text(encoding='utf-8'))
segments = []
for i, b in enumerate(beats, 1):
    if b['shot'] == 'title':
        im = card([('Tally', font(150, True), INK), ('Every promise to a customer, kept.', font(64), MUTED),
                    ('Customer commitments for Jira and Confluence', font(48), BRAND)])
    elif b['shot'] == 'closing':
        im = card([('Tally', font(150, True), INK), ('Every promise to a customer, kept.', font(64), MUTED),
                    ('Jira  ·  Confluence  ·  Rovo agent  ·  MCP  ·  Teamwork Graph', font(46), BRAND),
                    ('github.com/ifeoluwaadegbulugbe/Tally', font(40), MUTED)])
    elif b['shot'] == 'mcp':
        im = mcp_card()
    else:
        im = shot_frame(V / b['shot'], b['caption'])
    frame = OUT / f'frame-{i:02d}.png'
    im.save(frame)
    wav = V / f'say-{i:02d}.wav'
    dur = wav_seconds(wav) + 0.9
    seg = OUT / f'seg-{i:02d}.mp4'
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-loop', '1', '-i', str(frame), '-i', str(wav),
                    '-af', 'apad', '-t', f'{dur:.2f}', '-vf', 'fps=30,format=yuv420p',
                    '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-c:a', 'aac', '-b:a', '160k',
                    '-ar', '48000', '-ac', '2', str(seg)], check=True)
    segments.append((seg, dur))

lst = OUT / 'segments.txt'
lst.write_text(''.join(f"file '{s.as_posix()}'\n" for s, _ in segments), encoding='utf-8')
final = OUT / 'tally-demo.mp4'
subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', str(lst),
                '-c', 'copy', '-movflags', '+faststart', str(final)], check=True)
total = sum(d for _, d in segments)
print(f'video: {final} ({total:.1f} s, {len(segments)} beats)')

# Gallery: 3:2 images (1500 x 1000) for Devpost and the Marketplace.
gallery = [('01-dashboard.jpg', 'Dashboard: what needs attention and why'),
           ('04-review.jpg', 'Discovery inbox: a person confirms every promise'),
           ('09-why.jpg', 'Rule-based risk flags, each with its reason'),
           ('07-context.jpg', 'Teamwork Graph: related work for the linked Jira issue'),
           ('15-agent-answer.jpg', 'Tally Agent in Rovo: answers from stored facts'),
           ('12-facts.jpg', 'Customer updates from stored facts, approved by a person'),
           ('19-settings.jpg', 'Runs on Atlassian: Jira, Confluence, Teamwork Graph')]
GW, GH, GB = 1500, 1000, 110
for n, (shot, cap) in enumerate(gallery, 1):
    src = Image.open(V / shot).convert('RGB')
    scale = min(GW / src.width, (GH - GB) / src.height)
    s = src.resize((int(src.width * scale), int(src.height * scale)), Image.LANCZOS)
    s = s.filter(ImageFilter.UnsharpMask(radius=1.2, percent=60, threshold=2))
    im = Image.new('RGB', (GW, GH), CANVAS)
    im.paste(s, ((GW - s.width) // 2, (GH - GB - s.height) // 2))
    d = ImageDraw.Draw(im)
    d.rectangle([0, GH - GB, GW, GH], fill=BRAND)
    logo(d, 30, GH - GB + 20, 70)
    f = font(42, True)
    d.text((125, GH - GB + (GB - 42) / 2 - 6), cap, font=f, fill=(255, 255, 255))
    im.save(OUT / f'gallery-{n}.png')
print('gallery: 6 images')
