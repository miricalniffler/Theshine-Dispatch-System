from pathlib import Path
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import BaseDocTemplate, Frame, PageBreak, Paragraph, Spacer, Table, TableStyle, KeepTogether

OUT = Path('output/pdf/iway_接单发单操作流程总结.pdf')
OUT.parent.mkdir(parents=True, exist_ok=True)
FONT = '/System/Library/Fonts/STHeiti Medium.ttc'
pdfmetrics.registerFont(TTFont('CN', FONT, subfontIndex=0))

navy = colors.HexColor('#16324F')
blue = colors.HexColor('#2D6CDF')
light = colors.HexColor('#EDF4FF')
orange = colors.HexColor('#F59E0B')
grey = colors.HexColor('#52616B')

styles = getSampleStyleSheet()
title = ParagraphStyle('title', parent=styles['Title'], fontName='CN', fontSize=26, leading=34, textColor=navy, alignment=TA_CENTER, spaceAfter=10)
subtitle = ParagraphStyle('subtitle', parent=styles['Normal'], fontName='CN', fontSize=11, leading=18, textColor=grey, alignment=TA_CENTER)
h1 = ParagraphStyle('h1', parent=styles['Heading1'], fontName='CN', fontSize=18, leading=26, textColor=navy, spaceBefore=5, spaceAfter=10)
h2 = ParagraphStyle('h2', parent=styles['Heading2'], fontName='CN', fontSize=13, leading=20, textColor=blue, spaceBefore=8, spaceAfter=5)
body = ParagraphStyle('body', parent=styles['BodyText'], fontName='CN', fontSize=10, leading=17, textColor=colors.HexColor('#1F2937'), spaceAfter=5)
small = ParagraphStyle('small', parent=body, fontSize=8.5, leading=13, textColor=grey)
note = ParagraphStyle('note', parent=body, backColor=light, borderColor=colors.HexColor('#B9D3FF'), borderWidth=0.5, borderPadding=8, leading=16)

def P(text, style=body): return Paragraph(text, style)
def bullets(items):
    return [P('• ' + item) for item in items]

def footer(canvas, doc):
    canvas.saveState()
    canvas.setStrokeColor(colors.HexColor('#D7E2F0'))
    canvas.line(18*mm, 15*mm, 192*mm, 15*mm)
    canvas.setFont('CN', 8)
    canvas.setFillColor(grey)
    canvas.drawString(18*mm, 9*mm, 'iway 接单发单操作流程总结')
    canvas.drawRightString(192*mm, 9*mm, f'第 {doc.page} 页')
    canvas.restoreState()

doc = BaseDocTemplate(str(OUT), pagesize=A4, leftMargin=18*mm, rightMargin=18*mm, topMargin=20*mm, bottomMargin=21*mm)
doc.addPageTemplates([__import__('reportlab.platypus', fromlist=['PageTemplate']).PageTemplate(id='main', frames=[Frame(doc.leftMargin, doc.bottomMargin, doc.width, doc.height, id='normal')], onPage=footer)])
story = []
story += [Spacer(1, 45*mm), P('iway 接单发单<br/>操作流程总结', title), P('根据 4 段录屏及订单样本整理 | 适用于苏梅、曼谷等车队的日常派单与司机信息回传', subtitle), Spacer(1, 24*mm)]
flow = Table([[P('<b>1. 接单</b><br/>飞书邮箱读取新订单', small), P('<b>2. 核对</b><br/>iway 查看订单详情', small), P('<b>3. 发单</b><br/>石墨整理并发送车队', small), P('<b>4. 回填</b><br/>记录司机与车辆资料', small)]], colWidths=[43*mm]*4)
flow.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,-1),light),('BOX',(0,0),(-1,-1),0.5,colors.HexColor('#B9D3FF')),('INNERGRID',(0,0),(-1,-1),0.5,colors.white),('VALIGN',(0,0),(-1,-1),'MIDDLE'),('ALIGN',(0,0),(-1,-1),'CENTER'),('TOPPADDING',(0,0),(-1,-1),10),('BOTTOMPADDING',(0,0),(-1,-1),10)]))
story += [flow, Spacer(1, 20*mm), P('使用原则', h2), P('订单信息只从原始邮件和 iway 页面取值；发给车队前做一次交叉核对；收到回复后保留原始聊天记录并把标准化后的信息回填到工作区。', note), PageBreak()]

story += [P('一、完整流程一览', h1)]
rows = [
    [P('<b>环节</b>', small), P('<b>在哪里做</b>', small), P('<b>完成标志</b>', small)],
    [P('接收订单'), P('飞书邮箱：筛选/查看来自 dingdan@theshine.com.cn 的新邮件。'), P('已获得订单号与完整行程信息。')],
    [P('订单核对'), P('iway esforty 的 Rides 页面：按日期找订单，点开订单卡片查看详情。'), P('订单号、时间、路线、车型、人数相互一致。')],
    [P('整理派单'), P('石墨文档「临时工作区」：按固定字段逐单录入英文信息。'), P('每一单都有可直接复制发送的完整内容。')],
    [P('发送车队'), P('WhatsApp / 微信对应车队群。'), P('已发送订单信息；必要时附上备注或图片。')],
    [P('司机回传'), P('车队群消息 - 石墨工作区 - iway。'), P('司机、电话、车型、车牌已标准化、已核对。')],
]
t=Table(rows,colWidths=[28*mm,78*mm,68*mm],repeatRows=1)
t.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,0),navy),('TEXTCOLOR',(0,0),(-1,0),colors.white),('BACKGROUND',(0,1),(-1,-1),colors.white),('GRID',(0,0),(-1,-1),0.35,colors.HexColor('#C9D5E3')),('VALIGN',(0,0),(-1,-1),'TOP'),('LEFTPADDING',(0,0),(-1,-1),7),('RIGHTPADDING',(0,0),(-1,-1),7),('TOPPADDING',(0,0),(-1,-1),7),('BOTTOMPADDING',(0,0),(-1,-1),7)]))
story += [t, Spacer(1,10*mm), P('建议顺序：先把同一天的订单集中整理，再按目的地/车队批量发送。这样能减少来回切换页面，也更容易发现漏单。', note), PageBreak()]

story += [P('二、接单与 iway 核对', h1), P('1. 读取飞书邮件', h2)] + bullets([
    '进入已连接的飞书邮箱，查看来自 dingdan@theshine.com.cn 的新订单邮件。',
    '从邮件中抄录：Ride number、Date、Time、Vehicle class、From、To、Departure time、Remarks、乘客人数、Clients 电话、Meeting tablet。',
    '有 “meet with a sign” 或儿童座椅等备注时，必须完整保留，不要只复制主行程。'
]) + [P('2. 在 iway 页面交叉确认', h2)] + bullets([
    '打开 Rides，选择对应日期；未分配订单会显示 “Driver required”。',
    '点击订单卡片查看详情，重点确认订单号、接送时间、航班/出发时间、上下车地址、车型与人数行李。',
    '不要把 “pickup time” 与 “flight departure time” 混淆：给车队的是接客时间；航班时间保留在 Flight/Departure 字段。'
]) + [P('<b>检查点：</b>邮件、iway、石墨文档三处的订单号必须一致；地址如果很长，也不要随意删减酒店名、航站楼或区域。', note), PageBreak()]

story += [P('三、石墨文档与车队发单', h1), P('在「临时工作区」中，每个订单建议使用下面固定格式。字段名使用英文，便于车队直接阅读。', body)]
template = '''Order Number: [订单号]<br/>Pickup Time: [日期 + 接客时间，Asia/Bangkok]<br/>Flight / Departure Time: [航班号及时间；没有则填 none]<br/>Pickup Address: [完整上车地址]<br/>Drop-off Address: [完整下车地址]<br/>Vehicle Type: [车型 / 座位数]<br/>Passenger Name: [乘客姓名]<br/>Passenger Phone: [国际区号+号码]<br/>Passengers & Luggage: [成人/儿童/行李数量]<br/>Special Request: [举牌、儿童座椅、等待、收费路段等]<br/>Thank you!'''
story += [P(template, note), P('发送方式', h2)] + bullets([
    '苏梅车队：录屏中通过 WhatsApp / 微信群发送；按群内惯用格式发送完整英文订单。',
    '同一车队多单时，逐单分段发送，并保留订单号，方便对方逐条回复。',
    '发送后不要立即删除石墨中的订单内容；它是后续匹配司机回复的工作底稿。'
]) + [P('<b>发送前最后一眼：</b>订单号、日期、接客时间、目的地、车型。五项有一项错，司机就可能接错客。', note), PageBreak()]

story += [P('四、司机信息回传与标准化', h1), P('车队回复后，在石墨文档中为对应订单补充以下字段：', h2)]
return_rows = [[P('<b>字段</b>',small),P('<b>填写规则</b>',small)],
               [P('Driver Name'),P('按对方回复原样记录；泰文姓名可保留，同时可加英文转写。')],
               [P('Driver Phone'),P('统一国际格式。泰国本地 0 开头号码去掉 0 并加 +66，例如 082xxxxxxx → +6682xxxxxxx。')],
               [P('Vehicle Model'),P('填写明确车型，例如 Toyota Commuter / Toyota Ventury / Sedan。车队只发图片时，需要根据图片识别车型后记录。')],
               [P('License Plate'),P('完整记录车牌；泰文字符、数字及地区信息不要自行猜测。')]]
rt=Table(return_rows,colWidths=[42*mm,132*mm],repeatRows=1)
rt.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,0),navy),('TEXTCOLOR',(0,0),(-1,0),colors.white),('GRID',(0,0),(-1,-1),0.35,colors.HexColor('#C9D5E3')),('VALIGN',(0,0),(-1,-1),'TOP'),('LEFTPADDING',(0,0),(-1,-1),7),('RIGHTPADDING',(0,0),(-1,-1),7),('TOPPADDING',(0,0),(-1,-1),7),('BOTTOMPADDING',(0,0),(-1,-1),7)]))
story += [rt, Spacer(1,8*mm), P('不同车队的注意点', h2), P('<b>曼谷车队：</b>可能使用泰文回复、不写车型而只发车辆图片、电话号码不含国家区号。需要翻译、识别车型、补 +66。<br/><b>苏梅车队：</b>一般回复简洁且信息完整；若当天只有一单，可能不写订单号，需要结合发送顺序、时间和车型匹配。', note), PageBreak()]

story += [P('五、最终检查清单', h1)]
checks = [
    '邮件来源正确，订单号已记录。',
    'iway 中已确认订单状态与日期，订单仍需要司机时才发单。',
    '接客时间、航班/出发时间没有写反。',
    '上车/下车地址完整，机场名称和航站楼没有遗漏。',
    '车型、人数、行李、儿童座椅、举牌等特殊要求已经写入。',
    '发给车队的每条消息都带订单号。',
    '司机电话已加国家区号，车牌与车型已确认。',
    '司机回复已保存，并准确写回对应订单。'
]
for i,item in enumerate(checks,1):
    story.append(P(f'<b>□ {i:02d}</b>　{item}', body))
story += [Spacer(1,8*mm), P('常见风险提醒', h2), P('不要依据记忆补全地址或车牌；不要把车队的照片、泰文消息直接当作最终结构化记录；遇到订单号缺失时，先按时间、路线和车型核对，不能确定就向车队追问。', note), Spacer(1,15*mm), P('本文件基于 2026-07-16 录屏及提供样本整理。', small)]
doc.build(story)
print(OUT)
