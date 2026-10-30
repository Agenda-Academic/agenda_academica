"""Gera a versão de exportação (só telas, fontes embutidas, sem JS)."""
import base64, re, sys, urllib.request, pathlib

src, out, fontdir = map(pathlib.Path, sys.argv[1:4])
UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'
css_url = ('https://fonts.googleapis.com/css2?family=Open+Sans:wght@400..800'
           '&family=JetBrains+Mono:wght@400;500&display=swap')
css = urllib.request.urlopen(urllib.request.Request(css_url, headers={'User-Agent': UA}), timeout=30).read().decode()
faces = []
for comment, block in re.findall(r'/\*\s*([\w-]+)\s*\*/\s*(@font-face\s*\{[^}]*\})', css):
    if comment != 'latin':
        continue
    url = re.search(r'url\((https://[^)]+\.woff2)\)', block).group(1)
    name = fontdir / url.rsplit('/', 1)[-1]
    if not name.exists():
        name.write_bytes(urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': UA}), timeout=30).read())
    data = base64.b64encode(name.read_bytes()).decode()
    faces.append(block.replace(url, 'data:font/woff2;base64,' + data))
print('font faces embedded:', len(faces))

html = src.read_text(encoding='utf-8')
html = re.sub(r'<link rel="(?:preconnect|stylesheet)"[^>]*>\n?', '', html)
html = re.sub(r'<script>.*?</script>', '', html, flags=re.S)
override = ('\n'.join(faces) + '\n'
            '.g-top,.g-intro,.g-sec-head,.g-foot,.g-pager,.frame figcaption{display:none!important}\n'
            ':root{--z:1;--zm:1}\n.screen{zoom:1!important}\n'
            '.screen.desk,.screen.guide{border-radius:0!important;box-shadow:none!important}\n'
            '.screen.phone{box-shadow:none!important;border-radius:40px!important}\n'
            '.g-sec{padding:40px!important}\n'
            'body{min-width:1540px}.g-frames{align-items:flex-start!important}'
            '.g-phones{justify-content:flex-start!important}.frame{align-items:flex-start!important}\n')
html = html.replace('</style>', override + '</style>', 1)


NUM = re.compile(r'-?(?:\d+\.?\d*|\.\d+)(?:e-?\d+)?')


def fmt(v):
    return ('%.3f' % v).rstrip('0').rstrip('.') or '0'


def scale_path(d, k):
    """Escala os números de um atributo d; nos arcos, mantém rotação e flags."""
    out = []
    for cmd, args in re.findall(r'([MmLlHhVvCcSsQqTtAaZz])([^MmLlHhVvCcSsQqTtAaZz]*)', d):
        nums = [float(x) for x in NUM.findall(args)]
        if cmd in 'Aa':
            scaled = []
            for i, v in enumerate(nums):
                scaled.append(fmt(v) if i % 7 in (2, 3, 4) else fmt(v * k))
        else:
            scaled = [fmt(v * k) for v in nums]
        out.append(cmd + ' '.join(scaled))
    return ''.join(out)


def scale_attrs(tag, k):
    def rep(m):
        name, val = m.group(1), m.group(2)
        if name == 'd':
            return f'd="{scale_path(val, k)}"'
        if name in ('cx', 'cy', 'r', 'x', 'y', 'width', 'height', 'rx', 'ry', 'x1', 'y1', 'x2', 'y2'):
            return f'{name}="{fmt(float(val) * k)}"'
        return m.group(0)
    return re.sub(r'\b(d|cx|cy|r|x|y|width|height|rx|ry|x1|y1|x2|y2)="([^"]*)"', rep, tag)


def fix_svg(match):
    """O conversor do Figma ignora a escala do viewBox: reescreve o ícone já no tamanho final."""
    open_tag, body = match.group(1), match.group(2)
    cls = re.search(r'class="([^"]*)"', open_tag).group(1).split()
    style = (re.search(r'style="([^"]*)"', open_tag) or [None, ''])[1]
    w = re.search(r'(?<![-\w])width:\s*([\d.]+)px', style)
    size = float(w.group(1)) if w else 15.0 if 'i-s' in cls else 22.0 if 'i-l' in cls else 18.0
    k = size / 24.0
    sw = re.search(r'stroke-width:\s*([\d.]+)', style)
    stroke = float(sw.group(1)) if sw else 1.8
    new_open = re.sub(r'viewBox="[^"]*"', f'viewBox="0 0 {fmt(size)} {fmt(size)}"', open_tag)
    new_open = new_open[:-1] + (f' width="{fmt(size)}" height="{fmt(size)}" fill="none" stroke="currentColor"'
                                f' stroke-width="{fmt(stroke * k)}" stroke-linecap="round" stroke-linejoin="round">')
    new_body = re.sub(r'<(path|circle|rect)\b[^>]*>', lambda m: scale_attrs(m.group(0), k), body)
    return new_open + new_body + '</svg>'


html, n = re.subn(r'(<svg\b[^>]*class="i[^"]*"[^>]*>)(.*?)</svg>', fix_svg, html, flags=re.S)
print('svg icons rescaled:', n)
html = html.replace('<title>Telas da Agenda Acadêmica</title>', '<title>Agenda Acadêmica — exportação Figma</title>')
out.write_text(html, encoding='utf-8')
print('export:', out, len(html), 'bytes')
