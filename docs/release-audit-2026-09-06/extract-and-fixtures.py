from pathlib import Path
import json, re, struct, zlib, hashlib
import olefile
from docx import Document
from PIL import Image, ImageDraw, ImageFont, ImageEnhance

ROOT = Path(__file__).resolve().parents[2]
OUT = Path(__file__).resolve().parent
FIX = OUT / 'ocr-fixtures'
FIX.mkdir(exist_ok=True)
font_path = '/System/Library/Fonts/AppleSDGothicNeo.ttc'

for path in ROOT.glob('*.hwp'):
    ole = olefile.OleFileIO(path)
    compressed = bool(struct.unpack_from('<I', ole.openstream('FileHeader').read(), 36)[0] & 1)
    sections = sorted(p for p in ole.listdir() if p[0] == 'BodyText' and p[-1].startswith('Section'))
    text = []
    for section in sections:
        raw = ole.openstream(section).read()
        raw = zlib.decompress(raw, -15) if compressed else raw
        pos = 0
        while pos + 4 <= len(raw):
            header = struct.unpack_from('<I', raw, pos)[0]
            pos += 4
            tag, size = header & 1023, header >> 20
            if size == 4095:
                size = struct.unpack_from('<I', raw, pos)[0]
                pos += 4
            data = raw[pos:pos+size]
            pos += size
            if tag == 67:
                value = data.decode('utf-16le', errors='replace')
                value = re.sub(r'[\x00-\x08\x0b\x0c\x0e-\x1f]', '', value)
                text.append(value)
    (OUT / '기획서-추출.txt').write_text('\n'.join(text))
    print('HWP extracted:', len(''.join(text)), 'characters')

for path in ROOT.glob('*.docx'):
    d = Document(path)
    parts = []
    for element in d.element.body:
        parts.append(' '.join(element.itertext()))
    (OUT / '기능명세서-추출.txt').write_text('\n'.join(parts))

templates = [
    ('business', '사업자등록증', None),
    ('license', '영업신고증', None),
    ('tax', '부가가치세 과세표준증명', 36100000),
    ('pos', 'POS 월간 매출 집계표', 36100000),
    ('card', '카드매출 승인 및 정산내역', 24800000),
    ('account', '사업용 계좌 거래내역서', 29700000),
    ('delivery', '배달플랫폼 월간 정산서', 11300000),
    ('debt', '대출 잔액 증명서', 25000000),
    ('lease', '상가 임대차 계약서', 1500000),
    ('staff', '월별 급여 지급 명세서', 5600000),
]
cases = []
for ti, (source, title, amount) in enumerate(templates):
    for variant in ['clean', 'rotate', 'lowres', 'wrong_filename', 'missing_field']:
        number = len(cases) + 1
        image = Image.new('RGB', (1200, 1480), 'white')
        draw = ImageDraw.Draw(image)
        def write(x, y, text, size=36, fill='#162536'):
            draw.text((x,y), text, fill=fill, font=ImageFont.truetype(font_path,size))
        draw.rectangle((55, 60, 1145, 1390), outline='#647484', width=3)
        write(80, 85, 'OCR 검증용 가상 자료 · 실제 발급 문서 아님', 25, '#707070')
        write(95, 170, title, 51)
        fields = [('상호', '바른한상'), ('사업자등록번호', '123-45-67891'),
                  ('대표자', '김테스트'), ('사업장 소재지', '서울특별시 마포구 테스트로 12'),
                  ('문서 기준일', '2026-08-31'), ('기준기간', '2026-08-01 ~ 2026-08-31')]
        if variant == 'missing_field':
            fields[1] = ('사업자등록번호', '')
        if source == 'license': fields.append(('영업신고번호', '제2026-001234호'))
        if amount is not None:
            fields.append(({'tax':'과세표준 합계','pos':'매출 합계','card':'카드 승인 합계',
                            'account':'입금 합계','delivery':'배달 정산 합계','debt':'대출 잔액',
                            'lease':'월 임차료','staff':'급여 지급 합계'}[source], f'{amount:,} 원'))
        for row, (key, value) in enumerate(fields):
            y = 330 + row*108
            draw.line((85,y+80,1115,y+80),fill='#CFD6DC',width=2)
            write(95,y,key,31)
            write(440,y,value,34)
        write(95,1280,'기관 원본 조회·진위확인을 대체하지 않는 테스트 이미지',25,'#707070')
        if variant == 'rotate': image = image.rotate(3, expand=True, fillcolor='white')
        if variant == 'lowres': image = image.resize((480,592))
        name = f'{number:02d}-{source}-{variant}.png'
        image.save(FIX / name)
        cases.append({'id':f'OCR-{number:02d}', 'source':source, 'variant':variant, 'image':name,
                      'filename':('사업자등록증.png' if source!='business' else '배달정산서.png') if variant=='wrong_filename' else title+'.png',
                      'expected':{'merchant':'바른한상','businessNumber':'' if variant=='missing_field' else '1234567891',
                                  'total':amount, 'date':'2026-08-31'}})
(OUT/'ocr-cases.json').write_text(json.dumps(cases,ensure_ascii=False,indent=2))
assert len(cases)==50
print('OCR fixtures:',len(cases))
