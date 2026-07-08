/* ==========================================================================
 * 供应链Agent · 采购价诊断插件 —— 对话核心引擎
 * 5.1 意图理解 + 5.2 意图澄清（6子策略） + 通用采购价诊断 + 动态上下文
 * ========================================================================== */

/* ============ MOCK 数据（程序化生成大规模商品，贴近真实业务量级） ============ */
// 品类 → 品牌池 / 商品词根 / 事业部 / 采销归属
var CAT_META = {
  '家纺':   { dept:'家纺家居事业部', brands:['华信','暖冬','洁丽雅','水星','富安娜'], words:['纯棉四件套','羽绒被','毛巾3条装','抱枕套','冬被加厚','乳胶枕'], owners:['王采销','赵采销'], base:[60,300] },
  '家具':   { dept:'家纺家居事业部', brands:['成长树','林氏','源氏','全友'], words:['儿童学习桌','实木书架','布艺沙发','餐边柜','电脑椅'], owners:['张采销','孙采销'], base:[300,1500] },
  '家居':   { dept:'家纺家居事业部', brands:['纳川','禧天龙','爱丽思','美丽雅'], words:['收纳置物架','收纳箱','衣物挂架','浴室置物架','分类垃圾桶'], owners:['李采销','周采销'], base:[30,150] },
  '厨具':   { dept:'厨卫生活事业部', brands:['苏泊尔','爱仕达','双立人','康巴赫'], words:['不粘炒锅','刀具套装','保温杯','焖烧壶','蒸锅套装'], owners:['吴采销','郑采销'], base:[40,400] },
  '个护':   { dept:'个护清洁事业部', brands:['蓝月亮','立白','舒肤佳','高露洁'], words:['洗衣液大桶','洗手液补充','牙膏套装','沐浴露','消毒液'], owners:['冯采销','陈采销'], base:[15,120] },
  '数码配件':{ dept:'3C配件事业部', brands:['绿联','品胜','安克','倍思'], words:['快充充电器','数据线','移动电源','蓝牙耳机','手机支架'], owners:['杨采销','钱采销'], base:[25,300] }
};
var TRENDS = ['上升','稳定','下降'];
function seed(str){ var h=0; for(var i=0;i<str.length;i++){ h=(h*31+str.charCodeAt(i))>>>0; } return h; }
function rnd(s){ s.v=(s.v*1103515245+12345)&0x7fffffff; return s.v/0x7fffffff; }
// 生成 SKU 大盘
function genSkus(){
  var out=[], cats=Object.keys(CAT_META), idn=100010000;
  cats.forEach(function(cat){
    var m=CAT_META[cat];
    var count=[420,260,380,300,520,340][cats.indexOf(cat)]||300; // 各品类不同量级
    for(var i=0;i<count;i++){
      var s={v:seed(cat+i)+7};
      var brand=m.brands[Math.floor(rnd(s)*m.brands.length)];
      var word=m.words[Math.floor(rnd(s)*m.words.length)];
      var lo=m.base[0], hi=m.base[1];
      var bench=+(lo+rnd(s)*(hi-lo)).toFixed(2);          // 对标基准
      var devi=(rnd(s)-0.55)*0.4;                          // 采购价相对对标偏离 -22%~+18%
      var purchase=+(bench*(1+Math.max(-0.15,devi))).toFixed(2);
      var purTrend=TRENDS[Math.floor(rnd(s)*3)], saleTrend=TRENDS[Math.floor(rnd(s)*3)];
      var dur= devi>0.03 ? Math.floor(rnd(s)*40) : 0;      // 命中越深持续越久
      var stypes=['品牌商','授权经销商','贸易商'];
      var supplierType=stypes[Math.floor(rnd(s)*3)];
      out.push({
        id:String(idn++), name:brand+' '+word, cat:cat, brand:brand, dept:m.dept,
        supplier:brand+'官方旗舰', supplierType:supplierType, owner:m.owners[Math.floor(rnd(s)*m.owners.length)],
        purchase:purchase, mode30:+bench.toFixed(2), avg365:+(bench*1.03).toFixed(2), cost:+(bench*0.92).toFixed(2),
        piece:+(bench*0.98).toFixed(2),
        sale:+(bench*1.85).toFixed(2), vol30:Math.floor(80+rnd(s)*2400), gmv90:Math.floor(30000+rnd(s)*480000),
        salePriceTrend:saleTrend, purTrend:purTrend, durationDays:dur, benchBase:+bench.toFixed(2)
      });
    }
  });
  return out;
}
var SKUS = genSkus();

// 任意周期众数成交价：短周期更贴近近期成交（波动大），长周期更平滑
function modeByDays(s, days){
  var base=s.benchBase!=null?s.benchBase:s.mode30;
  var seedv=(seed(s.id+'_'+days))%1000/1000;
  var dir=seedv<0.5?-1:1;
  var factor=1 + dir*Math.min(0.12, Math.abs(30-days)/30*0.10*(0.5+seedv));
  return +(base*factor).toFixed(2);
}
/* 对标价口径：函数化，支持灵活切换与自定义周期 */
var BENCHMARKS = {
  mode7:   { label:'7天众数成交价',  fn:function(s){ return modeByDays(s,7); } },
  mode15:  { label:'15天众数成交价', fn:function(s){ return modeByDays(s,15); } },
  mode30:  { label:'30天众数成交价', fn:function(s){ return s.mode30; } },
  mode60:  { label:'60天众数成交价', fn:function(s){ return modeByDays(s,60); } },
  mode90:  { label:'90天众数成交价', fn:function(s){ return modeByDays(s,90); } },
  avg365:  { label:'365天均价',      fn:function(s){ return s.avg365; } },
  piece:   { label:'件单价',          fn:function(s){ return s.piece; }  },
  cost:    { label:'成本价',          fn:function(s){ return s.cost; }   }
};
// 动态注册任意天数众数口径（用户在澄清中提出的自定义 N 天），返回 benchmark key
function registerModeDays(days){
  var key='mode'+days;
  if(!BENCHMARKS[key]){ BENCHMARKS[key]={ label:days+'天众数成交价', fn:function(s){ return modeByDays(s,days); }, dynamic:true }; }
  return key;
}
/* 对比条件：判定命中的算子 */
var CONDITIONS = {
  gt:      { label:'采购价 > 对标价（前毛为负）', fn:function(p,b){ return p>b; } },
  devi5:   { label:'偏离度 > 5%',                 fn:function(p,b){ return (p-b)/p>0.05; } },
  devi10:  { label:'偏离度 > 10%',                fn:function(p,b){ return (p-b)/p>0.10; } }
};

/* ============ 会话上下文（全动态，不写死步骤） ============ */
var SESSION = {
  intent:null,            // diagnose / attribute / target / push / progress
  intentLabel:'',
  confidence:0,
  slots:{ scope:null, benchmark:null, condition:null },  // 采购价诊断三大必填槽位
  filledOrder:[],         // 已填顺序（用于渐进填充回溯）
  clarifyRounds:0,        // 轮次计数（策略④上限兜底）
  maxRounds:3,
  plan:[],                // 动态执行计划
  planIdx:-1,
  skills:[], products:[], docs:[],
  lastHits:[]             // 上一步诊断命中结果，供归因/目标复用
};

/* 采购价诊断的必填槽位定义（策略②澄清对象：参数级） */
var DIAG_SLOTS = [
  { key:'scope', name:'圈品范围', required:true, hint:'诊断哪些商品',
    options:[
      {v:'全部托管品类',   l:'全部托管品类（全盘巡检）'},
      {v:'家纺家居事业部', l:'家纺家居事业部（我负责）'},
      {v:'指定品类',       l:'指定品类…', input:true, ph:'如 家纺 / 厨具 / 个护'},
      {v:'指定品牌',       l:'指定品牌…', input:true, ph:'输入品牌名，如 苏泊尔'},
      {v:'指定供应商',     l:'指定供应商…', input:true, ph:'输入供应商名称'},
      {v:'指定SKU',        l:'手动圈选SKU…', input:true, ph:'输入SKU编码，逗号分隔'}
    ] },
  { key:'benchmark', name:'对标价口径', required:true, hint:'和什么价格比',
    options:[
      {v:'mode7',  l:'7天众数成交价'},
      {v:'mode30', l:'30天众数成交价'},
      {v:'mode90', l:'90天众数成交价'},
      {v:'avg365', l:'365天均价'},
      {v:'piece',  l:'件单价'},
      {v:'cost',   l:'成本价'},
      {v:'modeDays', l:'自定义天数众数…（枚举外，Agent即时取数）', input:true, ph:'输入任意天数，如 7 / 15 / 45'},
      {v:'custom', l:'指定固定值…', input:true, ph:'输入对标价，如 15.00'}
    ] },
  { key:'condition', name:'对比条件', required:true, hint:'满足什么算命中',
    options:[
      {v:'gt',     l:'采购价 > 对标价（前毛为负）'},
      {v:'devi5',  l:'偏离度 > 5%'},
      {v:'devi10', l:'偏离度 > 10%'}
    ] }
];

/* ============ 5.1 意图理解引擎 ============ */
// 关键词 → 意图 的轻量语义映射（模拟 LLM 意图分类）
var INTENT_RULES = [
  { intent:'refine',   label:'结果二次筛选', kw:['去掉','剔除','排除','过滤','只看','只保留','留下','其中','缩小','筛掉','不要'] },
  { intent:'analyze',  label:'占比/构成分析', kw:['占比','占多少','比例','GMV占','贡献','构成','分布','多大盘','大盘占'] },
  { intent:'diagnose', label:'诊断策略仿真', kw:['诊断','巡检','前毛','为负','异常','排查','看看','有多少','圈品','对标','测算','命中','规则','件单价','成本上涨','策略','仿真','阈值','口径','剔除','加白','管控范围','变更','对比测算'] },
  { intent:'attribute',label:'异常归因',   kw:['归因','为什么','原因','是采购还是销售','主因','销售价影响','流量款','战略亏损'] },
  { intent:'target',   label:'制定改善目标',kw:['目标','改善目标','降到','调价目标','议价目标','节降','划线价','优化效果'] },
  { intent:'push',     label:'推送治理任务',kw:['推送','派给','任务','通知采销','发起协商','汇总','分层','触达','京me','京Me','生成图片','生成html','生成HTML','机器人','下发','作业','催办','勾选'] },
  { intent:'progress', label:'改善进度 & 明细', kw:['进度','改善了吗','复盘','效果','是否改善','通晒','通晒报告','追踪','时效','周报','月报','完成率','状态','降价排名','排名','近4周','H2','H2至今','月至今','季至今','明细','清单','商品清单','降价商品','降价情况','净变化'] }
];
// 从自由文本抽取槽位（模拟 NER）
function extractSlots(text){
  var s={};
  // 范围：事业部 / 品类 / 品牌 / 供应商
  if(/全部|所有|全托管|全盘/.test(text)) s.scope='全部托管品类';
  else if(/家纺家居|家居事业部/.test(text)) s.scope='家纺家居事业部';
  else if(/厨卫|厨具/.test(text)) s.scope='指定品类：厨具';
  else if(/个护|清洁/.test(text)) s.scope='指定品类：个护';
  else if(/数码|3C|配件/.test(text)) s.scope='指定品类：数码配件';
  else if(/家纺/.test(text)) s.scope='指定品类：家纺';
  else if(/家具/.test(text)) s.scope='指定品类：家具';
  // 品牌命中（从数据品牌池中扫描）
  ALL_BRANDS.some(function(b){ if(text.indexOf(b)>=0){ s.scope='指定品牌：'+b; return true; } return false; });
  // 对标口径
  // 自定义周期众数成交价：识别「N天众数/N日成交价」等，动态注册口径
  var md=text.match(/(\d{1,3})\s*[天日]\s*(众数|成交价|成交)/);
  if(md){ s.benchmark=registerModeDays(parseInt(md[1],10)); }
  else if(/众数|成交价/.test(text)) s.benchmark='mode30';
  else if(/365|年均|均价/.test(text)) s.benchmark='avg365';
  else if(/件单价/.test(text)) s.benchmark='piece';
  else if(/成本价|成本/.test(text)) s.benchmark='cost';
  // 条件
  if(/前毛为负|亏|采购价高|大于/.test(text)) s.condition='gt';
  else if(/偏离10|偏离度10/.test(text)) s.condition='devi10';
  else if(/偏离5|偏离度5|偏离/.test(text)) s.condition='devi5';
  var _neg=/去掉|剔除|排除|过滤掉|不要|筛掉/.test(text);
  var _pos=/只看|只保留|留下|仅/.test(text);
  if(_neg||_pos){
    s.refineMode=_neg?'exclude':'include';
    if(/非品牌商|不是品牌商|非自营/.test(text)) s.refineField={f:'supplierType',op:'ne',v:'品牌商',label:'供应商身份≠品牌商'};
    else if(/品牌商/.test(text)) s.refineField={f:'supplierType',op:'eq',v:'品牌商',label:'供应商身份=品牌商'};
    else if(/经销商/.test(text)) s.refineField={f:'supplierType',op:'eq',v:'授权经销商',label:'供应商身份=授权经销商'};
    else if(/贸易商/.test(text)) s.refineField={f:'supplierType',op:'eq',v:'贸易商',label:'供应商身份=贸易商'};
    else { ALL_BRANDS.some(function(b){ if(text.indexOf(b)>=0){ s.refineField={f:'brand',op:'eq',v:b,label:'品牌='+b}; return true; } return false; }); }
  }
  if(/占比|占多少|比例|贡献|大盘|构成/.test(text)){
    if(/全量|全托管|大盘|全部/.test(text)) s.ratioBase='all';
    else if(/部门|事业部/.test(text)) s.ratioBase='dept';
    else if(/品类/.test(text)) s.ratioBase='cat';
    else s.ratioBase='scope';
  }
  return s;
}
// 全部品牌池（供NER与澄清使用）
var ALL_BRANDS=(function(){ var set={}; Object.keys(CAT_META).forEach(function(c){ CAT_META[c].brands.forEach(function(b){ set[b]=1; }); }); return Object.keys(set); })();
// 主入口：解析意图 + 槽位 + 置信度
function parseIntent(text){
  var scores={};
  INTENT_RULES.forEach(function(r){
    var hit=r.kw.filter(function(k){ return text.indexOf(k)>=0; }).length;
    if(hit>0) scores[r.intent]={n:hit,label:r.label};
  });
  var keys=Object.keys(scores);
  var intent=null,label='',conf=0,ambiguous=false,unknown=false;
  if(keys.length===0){
    // 无明确关键词：不臆断意图，标记 unknown → 走开放式反问确认「您是不是想做XX」
    intent='diagnose'; label='采购价诊断'; conf=0.3; unknown=true;
  } else {
    keys.sort(function(a,b){ return scores[b].n-scores[a].n; });
    intent=keys[0]; label=scores[intent].label;
    var top=scores[keys[0]].n, second=keys[1]?scores[keys[1]].n:0;
    conf=Math.min(0.5+top*0.18,0.98);
    // 多意图边界不清：Top1 与 Top2 分数接近
    if(keys.length>1 && top-second<=0) ambiguous=true;
    if(ambiguous) conf=Math.min(conf,0.55);
  }
  var slots=extractSlots(text);
  var cands = unknown
    ? INTENT_RULES.map(function(r){return {intent:r.intent,label:r.label};})
    : keys.slice(0,2).map(function(k){return {intent:k,label:scores[k].label};});
  return { intent:intent, label:label, confidence:conf, ambiguous:ambiguous, unknown:unknown,
           candidates:cands,
           slots:slots };
}

/* ============ 基础渲染 ============ */
var msgs;
var CONF_THRESHOLD=0.7;  // 策略①置信阈值

function scrollBottom(){ msgs.scrollTop = msgs.scrollHeight; }
function toast(m){ var t=document.getElementById('toast'); t.textContent=m; t.classList.add('show'); setTimeout(function(){t.classList.remove('show');},1800); }
function now(){ var d=new Date(); return '2026-07-01 '+String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0'); }
function fmt(n){ return '¥'+Number(n).toLocaleString('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:2}); }
function wan(n){ return (n/10000).toFixed(1)+'万'; }
function delay(fn){ addTyping(); setTimeout(fn,900); }

function addUser(text){
  var el=document.createElement('div'); el.className='msg-user';
  el.innerHTML='<div class="bubble">'+text+'</div>'; msgs.appendChild(el); scrollBottom();
}
function addTyping(){
  var el=document.createElement('div'); el.className='msg-ai'; el.id='typing';
  el.innerHTML='<div class="ai-av">Y</div><div class="ai-body"><div class="ai-name">小Y</div><div class="typing"><span></span><span></span><span></span></div></div>';
  msgs.appendChild(el); scrollBottom();
}
function removeTyping(){ var t=document.getElementById('typing'); if(t)t.remove(); }

// 通用AI气泡：opts=[{label,onclick}]；folds=[{type,title,text}]；extraHtml 插在文本后
function addAI(bodyHtml, opts, folds, extraHtml){
  removeTyping();
  var el=document.createElement('div'); el.className='msg-ai';
  var h='<div class="ai-av">Y</div><div class="ai-body"><div class="ai-name">小Y</div>';
  (folds||[]).forEach(function(f){
    var cls=f.type==='tool'?'fold tool':(f.type==='intent'?'fold intent':'fold');
    var ic=f.type==='tool'?'&#128295; 已完成工具调用':(f.type==='intent'?'&#129504; 意图理解':'&#10004; 已完成思考');
    h+='<div class="'+cls+'" onclick="tgl(this)">'+ic+' <span class="arrow">&#9662;</span></div><div class="fold-content" style="display:none">'+f.text+'</div>';
  });
  h+='<div class="ai-text">'+bodyHtml+'</div>';
  if(extraHtml) h+=extraHtml;
  if(opts&&opts.length){ h+='<div class="opts">'; opts.forEach(function(o,i){ h+='<div class="opt" data-i="'+i+'">'+o.label+'</div>'; }); h+='</div>'; }
  h+='<div class="msg-done"><span>&#10004; 回答完成</span><span class="time">'+now()+'</span><span class="ic">&#128203;</span><span class="ic">&#128077;</span><span class="ic">&#128078;</span><span class="ic">&#8635;</span></div>';
  h+='</div>';
  el.innerHTML=h;
  if(opts&&opts.length){ el.querySelectorAll('.opts .opt').forEach(function(o){ o.onclick=function(){ opts[+o.dataset.i].onclick(el); }; }); }
  msgs.appendChild(el); scrollBottom();
  return el;
}
function tgl(f){ var c=f.nextElementSibling; var a=f.querySelector('.arrow'); var open=c.style.display!=='none'; c.style.display=open?'none':'block'; a.style.transform=open?'':'rotate(180deg)'; scrollBottom(); }

/* ============ 产物存储 & 预览弹窗（图片 360×500 / HTML 即时生成） ============ */
var IMG_STORE={}, HTML_STORE={};
function openModal(title,inner){ var m=document.getElementById('modalMask'); document.getElementById('modalTitle').textContent=title; document.getElementById('modalBody').innerHTML=inner; m.classList.add('show'); }
function closeModal(){ document.getElementById('modalMask').classList.remove('show'); }
function previewImg(name){ openModal(name, '<img src="'+IMG_STORE[name]+'" width="360" height="500">'); }
function previewHtml(name){ var html=HTML_STORE[name]||''; var enc=encodeURIComponent(html); openModal(name, '<iframe src="data:text/html;charset=utf-8,'+enc+'"></iframe>'); }
function esc(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

// 生成 360×500 汇总图片（SVG → dataURL），内容按维度即时组织
function buildSummaryImage(pool,dim,rows){
  var W=360,H=500, totalLoss=pool.reduce(function(a,s){return a+lossOf(s);},0);
  var maxCnt=Math.max.apply(null,rows.map(function(r){return r.cnt;}).concat([1]));
  var colors=['#ff4d4f','#faad14','#1677ff','#722ed1','#12a150','#13c2c2'];
  var y=132, barW=170, x0=130, rowH=Math.min(38,(H-200)/Math.max(rows.length,1));
  var bars=rows.map(function(r,i){
    var w=Math.max(6,Math.round(barW*r.cnt/maxCnt)), cy=y+i*rowH, c=colors[i%colors.length];
    var label=(r.key.length>7?r.key.slice(0,7)+'…':r.key);
    return '<text x="16" y="'+(cy+13)+'" font-size="12" fill="#3d424b">'+esc(label)+'</text>'+
      '<rect x="'+x0+'" y="'+(cy+2)+'" rx="4" width="'+w+'" height="15" fill="'+c+'"/>'+
      '<text x="'+(x0+w+6)+'" y="'+(cy+14)+'" font-size="10" fill="#8a9099">'+r.cnt+'个/'+wan(r.loss)+'</text>';
  }).join('');
  var svg='<svg xmlns="http://www.w3.org/2000/svg" width="'+W+'" height="'+H+'">'+
    '<rect width="'+W+'" height="'+H+'" fill="#fff"/>'+
    '<rect width="'+W+'" height="70" fill="#e01c1c"/>'+
    '<text x="20" y="30" font-size="17" font-weight="bold" fill="#fff">采购价治理汇总</text>'+
    '<text x="20" y="52" font-size="12" fill="#ffd6d6">维度：'+esc(DIM_LABEL[dim])+' · 2026-07-01</text>'+
    '<text x="20" y="98" font-size="12" fill="#8a9099">待治理商品</text>'+
    '<text x="20" y="120" font-size="22" font-weight="bold" fill="#cf1322">'+pool.length+' 个</text>'+
    '<text x="190" y="98" font-size="12" fill="#8a9099">预计月损失</text>'+
    '<text x="190" y="120" font-size="22" font-weight="bold" fill="#cf1322">'+wan(totalLoss)+'</text>'+
    bars+
    '<text x="20" y="'+(H-16)+'" font-size="11" fill="#b0b4bb">供应链Agent · 京Me机器人推送</text>'+
    '</svg>';
  return 'data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg);
}
// 生成 HTML 汇总报告（内容维度按用户选择即时组织）
function buildSummaryHtml(pool,dim,rows){
  var totalLoss=pool.reduce(function(a,s){return a+lossOf(s);},0);
  var trs=rows.map(function(r){ return '<tr><td>'+esc(r.key)+'</td><td>'+r.cnt+'</td><td style="color:#cf1322">'+wan(r.loss)+'</td><td>'+(pool.length?Math.round(r.cnt/pool.length*100):0)+'%</td></tr>'; }).join('');
  var detail=pool.slice(0,20).map(function(s){ return '<tr><td>'+esc(s.name)+'</td><td>'+esc(s.owner)+'</td><td>'+fmt(s.purchase)+'</td><td style="color:#12a150">'+fmt(benchOf(s))+'</td><td style="color:#cf1322">'+wan(lossOf(s))+'</td></tr>'; }).join('');
  return '<!doctype html><html><head><meta charset="utf-8"><title>采购价治理汇总</title>'+
    '<style>body{font-family:-apple-system,"PingFang SC",sans-serif;margin:0;background:#f5f6fa;color:#1f2329}'+
    '.hd{background:#e01c1c;color:#fff;padding:20px 24px}.hd h1{margin:0;font-size:20px}.hd p{margin:6px 0 0;opacity:.85;font-size:13px}'+
    '.wrap{padding:20px 24px}.kpi{display:flex;gap:16px;margin-bottom:20px}.kb{flex:1;background:#fff;border-radius:10px;padding:16px;text-align:center}'+
    '.kb .v{font-size:26px;font-weight:800;color:#cf1322}.kb .l{font-size:12px;color:#8a9099;margin-top:4px}'+
    'h2{font-size:15px;margin:18px 0 10px}table{width:100%;border-collapse:collapse;background:#fff;border-radius:10px;overflow:hidden;font-size:13px}'+
    'th,td{padding:10px 12px;text-align:left;border-bottom:1px solid #f0f1f3}th{background:#fafbfc;color:#8a9099}</style></head><body>'+
    '<div class="hd"><h1>采购价治理汇总报告</h1><p>汇总维度：'+esc(DIM_LABEL[dim])+' ｜ 生成时间：2026-07-01 ｜ 供应链Agent 即时生成</p></div>'+
    '<div class="wrap"><div class="kpi"><div class="kb"><div class="v">'+pool.length+'</div><div class="l">待治理商品</div></div>'+
    '<div class="kb"><div class="v">'+wan(totalLoss)+'</div><div class="l">预计月损失</div></div>'+
    '<div class="kb"><div class="v">'+rows.length+'</div><div class="l">分组数</div></div></div>'+
    '<h2>分组汇总（'+esc(DIM_LABEL[dim])+'）</h2><table><thead><tr><th>'+esc(DIM_LABEL[dim])+'</th><th>商品数</th><th>月损失</th><th>占比</th></tr></thead><tbody>'+trs+'</tbody></table>'+
    '<h2>商品明细（前20）</h2><table><thead><tr><th>商品</th><th>采销</th><th>现采购价</th><th>目标价</th><th>月损失</th></tr></thead><tbody>'+detail+'</tbody></table>'+
    '</div></body></html>';
}

/* ============ 动态右侧上下文（随每步选择渲染，不写死） ============ */
function slotText(key,val){
  if(val==null) return null;
  if(key==='benchmark'){ if(val==='custom') return '指定固定值 '+(SESSION.customBench!=null?fmt(SESSION.customBench):''); return (BENCHMARKS[val]&&BENCHMARKS[val].label)||val; }
  if(key==='condition'){ return (CONDITIONS[val]&&CONDITIONS[val].label)||val; }
  return val;
}
function renderContext(){
  var b=document.getElementById('ctxBody'); var h='';
  // 1. 意图与置信
  if(SESSION.intent){
    h+='<div class="ctx-sec"><div class="sh">当前意图</div>';
    h+='<div class="slot-item"><span class="si-k">意图</span><span class="si-v">'+SESSION.intentLabel+'</span></div>';
    var pct=Math.round(SESSION.confidence*100);
    h+='<div style="font-size:12px;color:#8a9099;margin-top:6px">置信度 '+pct+'%</div><div class="conf-bar"><div class="cb" style="width:'+pct+'%;background:'+(SESSION.confidence>=CONF_THRESHOLD?'#52c41a':'#faad14')+'"></div></div></div>';
  }
  // 2. 意图参数（槽位）—— 动态，随填充状态显示
  if(SESSION.intent==='diagnose'){
    h+='<div class="ctx-sec"><div class="sh">诊断参数</div>';
    DIAG_SLOTS.forEach(function(sl){
      var v=slotText(sl.key,SESSION.slots[sl.key]);
      h+='<div class="slot-item'+(v==null?'missing':'')+'"><span class="si-k">'+sl.name+'</span><span class="si-v">'+(v==null?'待确认':v)+'</span></div>';
    });
    h+='</div>';
  }
  // 3. 执行计划 —— 意图确定后才生成，动态步骤
  if(SESSION.plan.length){
    h+='<div class="ctx-sec"><div class="sh">执行计划</div>';
    SESSION.plan.forEach(function(p,i){
      var st=i<SESSION.planIdx?'done':(i===SESSION.planIdx?'active':'');
      h+='<div class="plan-step '+st+'"><span class="ps-ic">'+(st==='done'?'&#10004;':(i+1))+'</span><span class="ps-t">'+p+'</span></div>';
    });
    h+='</div>';
  }
  // 4. 使用技能
  if(SESSION.skills.length){
    h+='<div class="ctx-sec"><div class="sh">使用技能</div>';
    SESSION.skills.forEach(function(s){ h+='<div class="ctx-skill">&#9881; <code>'+s.name+'</code> · '+s.cn+'</div>'; });
    h+='</div>';
  }
  // 5. 产物
  if(SESSION.products.length){
    h+='<div class="ctx-sec"><div class="sh">产物</div>';
    SESSION.products.forEach(function(p){ h+='<div class="ctx-doc">&#128196; '+p+'</div>'; });
    h+='</div>';
  }
  // 6. 参考文档
  if(SESSION.docs.length){
    h+='<div class="ctx-sec"><div class="sh">参考文档</div>';
    SESSION.docs.forEach(function(d){ h+='<div class="ctx-doc">&#128278; '+d+'</div>'; });
    h+='</div>';
  }
  b.innerHTML=h||'<div class="ctx-empty">等待您的诉求，Agent 将理解意图并动态展示上下文</div>';
}
function setPlan(steps){ SESSION.plan=steps; SESSION.planIdx=0; renderContext(); }
function advancePlan(){ SESSION.planIdx++; renderContext(); }
function addSkill(name,cn){ if(SESSION.skills.some(function(s){return s.name===name;}))return; SESSION.skills.push({name:name,cn:cn}); renderContext(); }
function addProduct(p){ if(SESSION.products.indexOf(p)<0)SESSION.products.push(p); renderContext(); }
function addDoc(d){ if(SESSION.docs.indexOf(d)<0)SESSION.docs.push(d); renderContext(); }

/* ============ 5.2 意图澄清引擎（6 子策略） ============ */
// ① 触发判定：意图层/参数层/置信层
function needClarify(res){
  if(res.unknown) return {type:'unknown', reason:'未能理解具体意图'};
  if(res.ambiguous) return {type:'intent', reason:'多意图边界不清'};
  if(res.confidence<CONF_THRESHOLD) return {type:'confidence', reason:'置信度低于阈值'};
  var miss=missingSlots();
  if(miss.length) return {type:'param', reason:'必填槽位缺失', slots:miss};
  return null;
}
function missingSlots(){
  if(SESSION.intent!=='diagnose') return []; // 仅诊断意图需要圈品/对标/条件三槽位
  return DIAG_SLOTS.filter(function(sl){ return sl.required && SESSION.slots[sl.key]==null; });
}
/* ============ 用户输入总入口（每轮都重新做意图理解，链路不写死） ============ */
function handleInput(text){
  /* 输入拦截钩子：处于报告上下文时，增维需求走小Y四步思考链（返回 true 表示已接管，不再走通用意图理解） */
  if(typeof window.__reportInputHook==='function'){
    try{ if(window.__reportInputHook(text)===true) return; }catch(e){}
  }
  addUser(text);
  document.getElementById('hintChips').innerHTML='';
  delay(function(){ understand(text); });
}
// 5.1 意图理解 → 5.2 澄清判定
function understand(text){
  var res=parseIntent(text);
  var switched = SESSION.intent && SESSION.intent!==res.intent;
  if(switched){ // 意图切换：重置该意图相关的执行态与澄清轮次（链路不锁定）
    SESSION.clarifyRounds=0; SESSION.plan=[]; SESSION.planIdx=-1;
  }
  SESSION.intent=res.intent; SESSION.intentLabel=res.label; SESSION.confidence=res.confidence;
  Object.keys(res.slots).forEach(function(k){ if(res.slots[k]!=null) SESSION.slots[k]=res.slots[k]; });
  renderContext();
  /* V6：置信度达标就立即唤起对应右侧操作区（不等参数澄清完成，边聊边配置） */
  if(res.confidence>=CONF_THRESHOLD && !res.ambiguous){
    if(res.intent==='progress' && typeof window.__openProgress==='function'){
      try{ window.__openProgress(); }catch(e){}
    } else if(res.intent==='diagnose' && typeof window.__openStrategy==='function'){
      try{ window.__openStrategy(); }catch(e){}
    }
  }
  var intentFold={type:'intent', text:
    '意图分类：'+res.label+'（置信 '+Math.round(res.confidence*100)+'%）'+(switched?' [已从上一意图切换]':'')+(res.unknown?' — 未明确识别，将开放式反问':'')+'\n'+
    (res.ambiguous?'候选意图：'+res.candidates.map(function(c){return c.label;}).join(' / ')+'（边界不清，需消歧）\n':'')+
    (res.intent==='diagnose'?('槽位抽取：\n'+
    DIAG_SLOTS.map(function(sl){ var v=slotText(sl.key,SESSION.slots[sl.key]);return '· '+sl.name+'：'+(v==null?'（缺失）':v); }).join('\n')):'该意图无需诊断三槽位，可直接执行或做参数级澄清') };
  var clar=needClarify(res);
  if(!clar){
    addAI('已理解您的意图：<b>'+res.label+'</b>，参数齐全，直接为您执行。', null, [intentFold]);
    var bk=SESSION.slots.benchmark;
    if(bk && BENCHMARKS[bk] && BENCHMARKS[bk].dynamic && SESSION.intent==='diagnose'){
      var dd=parseInt(String(bk).replace(/\D/g,''),10);
      showDynamicFetch(dd); setTimeout(execute,1900); return;
    }
    execute(); return;
  }
  SESSION.clarifyRounds++;
  if(SESSION.clarifyRounds>SESSION.maxRounds){
    fillDefaults();
    addAI('多轮澄清已达上限，我已对未确认项采用<b>安全默认值</b>并继续执行（可在结果中调整）。', null, [intentFold]);
    execute(); return;
  }
  if(clar.type==='unknown'){ clarifyUnknownIntent(res,intentFold); return; }
  if(clar.type==='intent'){ clarifyIntentAmbiguity(res,intentFold); return; }
  if(clar.type==='confidence'){ clarifyConfidence(res,intentFold); return; }
  clarifyParams(clar.slots,intentFold);
}
/* 策略⑦ 未理解：开放式反问确认「您是不是想做XX」，列出全部可选意图 */
function clarifyUnknownIntent(res,fold){
  addAI('抱歉，我没太确定您想做的是什么。您是不是想做下面某一项？点选后我立即为您执行：',
    res.candidates.map(function(c){ return {label:c.label, onclick:function(){ addUser('我想：'+c.label); SESSION.intent=c.intent; SESSION.intentLabel=c.label; SESSION.confidence=0.9; SESSION.clarifyRounds=0; renderContext(); delay(function(){ routeAfterIntent(); }); }}; }),
    [fold]);
}
/* 策略⑥ 消歧：给 1-2 个候选意图 */
function clarifyIntentAmbiguity(res,fold){
  addAI('您的描述可能对应多个操作，为避免执行偏差，请确认您想做的是：',
    res.candidates.map(function(c){ return {label:c.label, onclick:function(){ addUser(c.label); SESSION.intent=c.intent; SESSION.intentLabel=c.label; SESSION.confidence=0.9; renderContext(); delay(function(){ routeAfterIntent(); }); }}; }),
    [fold]);
}
/* 策略① 置信层 确认式澄清 */
function clarifyConfidence(res,fold){
  addAI('我理解您大概是想做 <b>'+res.label+'</b>，但不太确定。请确认或重新描述：',
    [{label:'对，就是「'+res.label+'」', onclick:function(){ addUser('确认：'+res.label); SESSION.confidence=0.9; renderContext(); delay(function(){ routeAfterIntent(); }); }},
     {label:'不是，我重新说', onclick:function(){ addUser('重新描述'); delay(function(){ addAI('好的，请重新描述您的诉求，我会更精准地理解。'); }); }}],
    [fold]);
}
function routeAfterIntent(){
  var miss=missingSlots();
  if(SESSION.intent==='diagnose' && miss.length){ clarifyParams(miss,null); }
  else { execute(); }
}
function fillDefaults(){
  if(SESSION.slots.scope==null) SESSION.slots.scope='家纺家居事业部';
  if(SESSION.slots.benchmark==null) SESSION.slots.benchmark='mode30';
  if(SESSION.slots.condition==null) SESSION.slots.condition='gt';
  renderContext();
}
/* 策略③ 参数级澄清：多槽合并为多Tab卡 + 渐进填充 + 选项化优先 */
var CC_STATE={ slots:[], active:0 };
function clarifyParams(missSlots,fold){
  CC_STATE.slots=missSlots; CC_STATE.active=0;
  var tip=missSlots.length>1?'检测到 <b>'+missSlots.length+'项</b>必填参数待确认，我合并为一张卡片，选完一项自动跳到下一项：':'还差一项必填参数，请确认：';
  var el=addAI('要执行 <b>'+SESSION.intentLabel+'</b>，'+tip, null, fold?[fold]:null, renderClarifyCard());
  bindClarifyCard(el);
}
function renderClarifyCard(){
  var h='<div class="clarify-card"><div class="cc-head">&#128295; 执行前参数澄清（必填齐全才执行）</div>';
  h+='<div class="cc-tabs">';
  CC_STATE.slots.forEach(function(sl,i){
    var filled=SESSION.slots[sl.key]!=null;
    h+='<div class="cc-tab '+(i===CC_STATE.active?'active':'')+(filled?' filled':'')+'" data-i="'+i+'">'+sl.name+'<span class="dot"></span></div>';
  });
  h+='</div>';
  var cur=CC_STATE.slots[CC_STATE.active];
  h+='<div class="cc-pane"><div class="cc-label">'+cur.hint+'<span class="req">*</span></div><div class="cc-opts">';
  cur.options.forEach(function(o){
    var sel=SESSION.slots[cur.key]===o.v?' sel':'';
    h+='<div class="cc-opt'+sel+'" data-k="'+cur.key+'" data-v="'+o.v+'" data-in="'+(o.input?1:0)+'" data-ph="'+(o.ph||'')+'">'+o.l+'</div>';
  });
  h+='</div><div class="cc-inputwrap"></div></div>';
  var allFilled=CC_STATE.slots.every(function(sl){return SESSION.slots[sl.key]!=null;});
  h+='<div class="cc-foot"><span class="cc-hint">'+(allFilled?'全部必填已就绪':'请完成标红的必填项')+'</span>'+
     '<button class="cc-btn ghost" data-act="skip">跳过用默认</button>'+
     '<button class="cc-btn primary" data-act="go"'+(allFilled?'':' disabled')+'>确认并执行</button></div>';
  h+='</div>';
  return h;
}
function bindClarifyCard(el){
  var card=el.querySelector('.clarify-card'); if(!card)return;
  function rerender(){ card.outerHTML=renderClarifyCard(); bindClarifyCard(el); renderContext(); }
  card.querySelectorAll('.cc-tab').forEach(function(t){ t.onclick=function(){ CC_STATE.active=+t.dataset.i; rerender(); }; });
  card.querySelectorAll('.cc-opt').forEach(function(o){ o.onclick=function(){
    var k=o.dataset.k, v=o.dataset.v;
    if(+o.dataset.in===1){
      var wrap=card.querySelector('.cc-inputwrap');
      wrap.innerHTML='<div class="cc-input"><input type="text" placeholder="'+o.dataset.ph+'"><button class="cc-btn primary">确定</button></div>';
      var inp=wrap.querySelector('input'), btn=wrap.querySelector('button'); inp.focus();
      btn.onclick=function(){ var val=inp.value.trim(); if(!val)return;
        applySlot(k,v==='custom'?'custom':v,val); rerender();
        // 枚举外自定义周期众数：展示 Agent 判别意图 → 数据库即时取数 的过程
        if(k==='benchmark'&&v==='modeDays'){ showDynamicFetch(parseInt(val,10)); }
      };
      inp.addEventListener('keydown',function(e){ if(e.key==='Enter'){ e.preventDefault(); btn.onclick(); } });
      return;
    }
    applySlot(k,v);
    var nextIdx=-1;
    CC_STATE.slots.forEach(function(sl,i){ if(nextIdx<0 && i>CC_STATE.active && SESSION.slots[sl.key]==null) nextIdx=i; });
    if(nextIdx<0) CC_STATE.slots.forEach(function(sl,i){ if(nextIdx<0 && SESSION.slots[sl.key]==null) nextIdx=i; });
    if(nextIdx>=0) CC_STATE.active=nextIdx;
    rerender();
  }; });
  var go=card.querySelector('[data-act="go"]'); if(go)go.onclick=function(){ finishClarify(false); };
  var skip=card.querySelector('[data-act="skip"]'); if(skip)skip.onclick=function(){ finishClarify(true); };
}
function applySlot(key,v,customVal){
  if(key==='benchmark'&&v==='custom'){ SESSION.slots.benchmark='custom'; SESSION.customBench=parseFloat(customVal); }
  else if(key==='benchmark'&&v==='modeDays'){
    // 枚举外自定义周期：用户输入任意天数，Agent 判别意图后动态注册该口径并从"数据库"取数
    var days=parseInt(customVal,10);
    if(days>0){ SESSION.slots.benchmark=registerModeDays(days); SESSION.dynBenchDays=days; }
  }
  else if(key==='scope'&&customVal){ SESSION.slots.scope=v+'：'+customVal; }
  else { SESSION.slots[key]=v; }
  if(SESSION.filledOrder.indexOf(key)<0)SESSION.filledOrder.push(key);
  renderContext();
}
/* 枚举外自定义口径：Agent 判别意图 → 从数据库即时取数 → 参与后续比较 */
function showDynamicFetch(days){
  if(!(days>0)) return;
  addDoc('成交价数据宽表 dwd_deal_price（'+days+'天窗口）');
  var sample=scopedSkus().slice(0,5);
  if(!sample.length) sample=SKUS.slice(0,5);
  var rows=sample.map(function(s){
    var mv=modeByDays(s,days);
    return '<tr><td>'+esc(s.name)+'</td><td>'+esc(s.id)+'</td><td class="num-green">'+fmt(mv)+'</td></tr>';
  }).join('');
  delay(function(){
    addAI('识别到您想用 <b>'+days+'天众数成交价</b> 作为对标口径——这不在预置枚举中，我已<b>动态判别意图并从成交价数据库即时取数</b>：按 SKU 在最近 '+days+' 天的成交订单中计算众数价，作为对标基准参与命中判定与偏离度比较。',
      null,
      [{type:'intent',text:'意图识别：用户诉求「'+days+'天众数成交价」属于枚举外自定义对标口径。\n处置：动态注册口径 mode'+days+' → 调用取数工具从成交明细库按窗口计算众数 → 注入 benchOf 参与后续所有计算。'},
       {type:'tool',text:'Tool: query_deal_mode_price(sku, window='+days+'d) → 从 dwd_deal_price 取数\nSkill: benchmark_calc(mode'+days+') 已动态注册\n口径已生效，可直接执行诊断'}],
      '<div class="mini-card"><div class="mini-title">&#128202; 即时取数样本 · '+days+'天众数成交价（前5个SKU）</div>'+
      '<table><thead><tr><th>商品</th><th>SKU</th><th>'+days+'天众数成交价</th></tr></thead><tbody>'+rows+'</tbody></table>'+
      '<div style="font-size:12px;color:#8a9099;margin-top:6px">该口径已注入本次诊断，命中判定与偏离度将基于此价计算。</div></div>');
  });
}
/* 策略⑤ 终止：必填填满且置信达标 → 结束澄清并执行 */
function finishClarify(useDefault){
  if(useDefault) fillDefaults();
  var summary=DIAG_SLOTS.map(function(sl){ return sl.name+'='+slotText(sl.key,SESSION.slots[sl.key]); }).join('，');
  addUser('确认参数：'+summary);
  SESSION.confidence=Math.max(SESSION.confidence,0.9); renderContext();
  delay(function(){ addAI('参数已就绪（'+summary+'），开始执行 <b>'+SESSION.intentLabel+'</b>。'); execute(); });
}
/* ============ 执行层：按意图路由 ============ */
function execute(){
  syncGoldenFlow();
  /* V6：对话识别到 progress / diagnose 意图 → 自动唤起右侧操作区（与点意图卡片等价） */
  if(SESSION.intent==='progress' && typeof window.__openProgress==='function'){
    window.__openProgress();
    return;
  }
  if(SESSION.intent==='diagnose' && typeof window.__openStrategy==='function'){
    /* 打开右侧「诊断策略仿真」操作区，同时保留对话式命中呈现 */
    window.__openStrategy();
  }
  if(SESSION.intent==='diagnose') runDiagnose();
  else if(SESSION.intent==='attribute') runAttribute();
  else if(SESSION.intent==='target') runTarget();
  else if(SESSION.intent==='push') runPush();
  else if(SESSION.intent==='progress') runProgress();
  else if(SESSION.intent==='refine') runRefine();
  else if(SESSION.intent==='analyze') runAnalyze();
}
/* 意图 → 黄金流程步骤（看现状/配策略/做仿真/去上线） */
function syncGoldenFlow(){
  if(typeof setGoldenStep!=='function') return;
  var map={ diagnose:0, refine:0, analyze:0, attribute:1, target:1, push:3, progress:3 };
  var step=map[SESSION.intent]; if(step==null) step=0;
  setGoldenStep(step);
}
/* 通用诊断计算：依据槽位的对标口径 + 对比条件 */
function benchOf(s){ var b=SESSION.slots.benchmark; if(b==='custom')return SESSION.customBench; return (BENCHMARKS[b]&&BENCHMARKS[b].fn(s))||s.mode30; }
function hitOf(s){ var c=SESSION.slots.condition||'gt'; return CONDITIONS[c].fn(s.purchase,benchOf(s)); }
function lossOf(s){ return Math.max((s.purchase-benchOf(s)),0)*s.vol30; }
function deviOf(s){ return (s.purchase-benchOf(s))/s.purchase; }
function scopedSkus(){
  var sc=SESSION.slots.scope||'';
  return SKUS.filter(function(s){
    if(sc==='家纺家居事业部'||sc.indexOf('家纺家居')>=0) return s.dept==='家纺家居事业部';
    if(sc.indexOf('品类')>=0){ var c=sc.split('：')[1]||''; return c?s.cat===c:true; }
    if(sc.indexOf('品牌')>=0){ var br=sc.split('：')[1]||''; return br?s.brand===br:true; }
    if(sc.indexOf('供应商')>=0){ var kw=sc.split('：')[1]||''; return kw?s.supplier.indexOf(kw)>=0:true; }
    if(sc.indexOf('SKU')>=0){ var ids=(sc.split('：')[1]||'').split(/[,，]/); return ids[0]===''?true:ids.some(function(id){return s.id===id.trim();}); }
    return true; // 全部托管品类
  });
}
function attrOf(s){ if(s.purTrend==='上升'&&s.salePriceTrend!=='下降')return{t:'purchase',l:'采购价问题'}; if(s.purTrend!=='上升'&&s.salePriceTrend==='下降')return{t:'sale',l:'销售价问题'}; return{t:'mixed',l:'综合问题'}; }
function natOf(s){ return s.durationDays>=7?{t:'persist',l:'持续性异常'}:{t:'short',l:'短期波动'}; }
/* 意图1：采购价诊断 */
function runDiagnose(){
  setPlan(['圈品与取数','对标价计算','命中判定与仿真','结果呈现']);
  addSkill('commodity_pool_filter','商品池筛选'); addSkill('benchmark_calc','对标价计算'); addSkill('poc_simulation','命中仿真');
  addDoc('采购价诊断策略.yaml');
  var pool=scopedSkus();
  advancePlan(); advancePlan();
  var hits=pool.filter(hitOf); SESSION.lastHits=hits;
  var total=hits.reduce(function(a,s){return a+lossOf(s);},0);
  advancePlan();
  var benchLabel=SESSION.slots.benchmark==='custom'?('指定值'+fmt(SESSION.customBench)):BENCHMARKS[SESSION.slots.benchmark].label;
  var condLabel=CONDITIONS[SESSION.slots.condition].label;
  var rows=hits.slice(0,12).map(function(s){ return '<tr><td><b>'+s.name+'</b><br><span style="color:#a0a4ab">'+s.id+' · '+s.owner+'</span></td><td>'+fmt(s.purchase)+'</td><td>'+fmt(benchOf(s))+'</td><td class="num-red">+'+(deviOf(s)*100).toFixed(1)+'%</td><td class="num-red">'+wan(lossOf(s))+'</td></tr>'; }).join('')+(hits.length>12?'<tr><td colspan="5" style="text-align:center;color:#8a9099">…共 '+hits.length+' 个命中，仅展示前 12 个，完整清单见右侧产物</td></tr>':'');
  delay(function(){
    advancePlan();
    var card='<div class="mini-card"><div class="mini-title">&#128202; 诊断仿真结果 · '+SESSION.slots.scope+'</div>'+
      '<div class="mini-metrics">'+
      '<div class="mm"><div class="v num-red">'+hits.length+'</div><div class="l">命中SKU</div></div>'+
      '<div class="mm"><div class="v num-red">'+wan(total)+'</div><div class="l">月前毛损失</div></div>'+
      '<div class="mm"><div class="v">'+(pool.length?Math.round(hits.length/pool.length*100):0)+'%</div><div class="l">命中占比</div></div>'+
      '<div class="mm"><div class="v num-green">'+wan(total*0.62)+'</div><div class="l">可改善空间</div></div></div>'+
      (hits.length?'<table><thead><tr><th>SKU</th><th>采购价</th><th>对标价</th><th>偏离度</th><th>月损失</th></tr></thead><tbody>'+rows+'</tbody></table>':'<div style="color:#8a9099;font-size:13px">当前口径下无命中商品。</div>')+'</div>';
    var think='本次诊断口径（来自您的确认）：\n· 圈品范围：'+SESSION.slots.scope+'（取数 '+pool.length+' 个SKU）\n· 对标价口径：'+benchLabel+'\n· 命中条件：'+condLabel;
    var tool='Skill: commodity_pool_filter → 圈定 '+pool.length+' 个SKU\nSkill: benchmark_calc('+SESSION.slots.benchmark+') → 计算对标价\nSkill: poc_simulation + Model: front_margin_impact → 命中 '+hits.length+' 个';
    addProduct('诊断仿真结果_'+SESSION.slots.scope+'.xlsx');
    if(hits.length && typeof setGoalMetrics==='function'){
      setGoalMetrics(hits.length, wan(total), wan(total*0.62), (pool.length?Math.round(hits.length/pool.length*100):0)+'%');
    }
    if(hits.length && typeof setPallet==='function'){
      var byCat={}; hits.forEach(function(s){ byCat[s.cat]=(byCat[s.cat]||0)+1; });
      var pal=[{name:'货盘 · '+(SESSION.slots.scope||'全部'),sub:'命中 '+hits.length+' 个'}];
      Object.keys(byCat).slice(0,3).forEach(function(c){ pal.push({name:c,sub:byCat[c]+' 个SKU'}); });
      setPallet(pal);
    }
    if(!hits.length){ addAI('按当前口径未发现命中商品。您可以调整对标口径或对比条件重新诊断。',
      [{label:'放宽为偏离度>5%', onclick:function(){ SESSION.slots.condition='devi5'; renderContext(); addUser('放宽为偏离度>5%'); delay(runDiagnose); }},
       {label:'换个范围', onclick:function(){ addUser('换个范围'); delay(function(){ addAI('请输入新的诊断范围，例如「全部托管品类」。'); }); }}],
      [{type:'think',text:think},{type:'tool',text:tool}]); return; }
    addAI('诊断完成：命中 <b class="num-red">'+hits.length+'个</b>异常SKU，月前毛损失 <b class="num-red">'+wan(total)+'</b>。<br><br>接下来您想怎么处理？',
      [{label:'归因分析（找根因）', onclick:function(){ nextIntent('attribute'); }},
       {label:'二次筛选（如去掉非品牌商）', onclick:function(){ SESSION.slots.refineField=null; nextIntent('refine'); }},
       {label:'看这批的GMV占比', onclick:function(){ SESSION.slots.ratioBase=null; nextIntent('analyze'); }},
       {label:'直接制定改善目标', onclick:function(){ nextIntent('target'); }},
       {label:'先导出，暂不处理', onclick:function(){ addUser('导出报告'); delay(function(){ addAI('已导出诊断报告至右侧产物区。随时可继续归因或制定改善方案。'); }); }}],
      [{type:'think',text:think},{type:'tool',text:tool}], card);
  });
}
function nextIntent(intent){
  var map={diagnose:'采购价诊断',attribute:'异常归因',target:'制定改善目标',push:'推送治理任务',progress:'改善进度查看',refine:'结果二次筛选',analyze:'占比/构成分析'};
  SESSION.intent=intent; SESSION.intentLabel=map[intent]; SESSION.confidence=0.95;
  addUser(map[intent]); renderContext(); delay(function(){ execute(); });
}
/* ============ 意图：结果集二次筛选（在已命中结果上按条件剔除/保留） ============ */
function currentResultSet(){
  if(SESSION.refinedHits && SESSION.refinedHits.length) return SESSION.refinedHits;
  if(SESSION.lastHits && SESSION.lastHits.length) return SESSION.lastHits;
  return null;
}
function matchField(s,f){
  if(f.f==='supplierType') return f.op==='ne'? s.supplierType!==f.v : s.supplierType===f.v;
  if(f.f==='brand') return s.brand===f.v;
  return true;
}
function runRefine(){
  var base=currentResultSet();
  if(!base){
    addAI('二次筛选需要先有一份诊断结果。请先执行一次采购价诊断，我再帮您在结果上按条件剔除或保留。',
      [{label:'去做采购价诊断', onclick:function(){ nextIntent('diagnose'); }}]);
    return;
  }
  var f=SESSION.slots.refineField, mode=SESSION.slots.refineMode||'exclude';
  if(!f){
    var supTypes=['品牌商','授权经销商','贸易商'];
    addAI('我理解您想在当前 <b>'+base.length+'个</b>结果上做<b>二次筛选</b>，但还需确认筛选条件。常见按<b>供应商身份</b>剔除，请选择：',
      supTypes.map(function(t){ return {label:'去掉「'+t+'」的SKU', onclick:function(){ SESSION.slots.refineField={f:'supplierType',op:'eq',v:t,label:'供应商身份='+t}; SESSION.slots.refineMode='exclude'; addUser('去掉'+t+'的SKU'); delay(runRefine); }}; })
      .concat([{label:'只保留品牌商', onclick:function(){ SESSION.slots.refineField={f:'supplierType',op:'eq',v:'品牌商',label:'供应商身份=品牌商'}; SESSION.slots.refineMode='include'; addUser('只保留品牌商'); delay(runRefine); }}]),
      [{type:'intent',text:'意图=结果二次筛选。已定位作用对象为上一步命中结果集（'+base.length+'个SKU），缺少「筛选条件」，触发参数级澄清。'}]);
    return;
  }
  setPlan(['定位结果集','应用筛选条件','重算指标','结果呈现']);
  addSkill('result_set_refine','结果集二次筛选'); advancePlan(); advancePlan();
  var keep=base.filter(function(s){ var m=matchField(s,f); return mode==='exclude'? !m : m; });
  var removed=base.length-keep.length;
  SESSION.refinedHits=keep; SESSION.lastHits=keep;
  var lossBefore=base.reduce(function(a,s){return a+lossOf(s);},0);
  var lossAfter=keep.reduce(function(a,s){return a+lossOf(s);},0);
  advancePlan();
  var rows=keep.slice(0,12).map(function(s){ return '<tr><td><b>'+s.name+'</b><br><span style="color:#a0a4ab">'+s.id+'</span></td><td>'+s.supplierType+'</td><td>'+fmt(s.purchase)+'</td><td>'+fmt(benchOf(s))+'</td><td class="num-red">'+wan(lossOf(s))+'</td></tr>'; }).join('')+(keep.length>12?'<tr><td colspan="5" style="text-align:center;color:#8a9099">…共 '+keep.length+' 个，仅展示前 12 个</td></tr>':'');
  delay(function(){ advancePlan();
    var card='<div class="mini-card"><div class="mini-title">&#128295; 二次筛选结果 · '+(mode==='exclude'?'剔除':'保留')+' '+esc(f.label)+'</div><div class="mini-metrics">'+
      '<div class="mm"><div class="v">'+base.length+'</div><div class="l">筛选前</div></div>'+
      '<div class="mm"><div class="v num-red">-'+removed+'</div><div class="l">剔除</div></div>'+
      '<div class="mm"><div class="v num-green">'+keep.length+'</div><div class="l">筛选后</div></div>'+
      '<div class="mm"><div class="v num-red">'+wan(lossAfter)+'</div><div class="l">月损失(后)</div></div></div>'+
      (keep.length?'<table><thead><tr><th>SKU</th><th>供应商身份</th><th>采购价</th><th>对标价</th><th>月损失</th></tr></thead><tbody>'+rows+'</tbody></table>':'<div style="color:#8a9099;font-size:13px">筛选后无剩余商品。</div>')+'</div>';
    addProduct('二次筛选结果_'+f.label+'.xlsx');
    addAI('已理解并处理二次筛选：在 <b>'+base.length+'个</b>结果上'+(mode==='exclude'?'剔除':'仅保留')+' <b>'+esc(f.label)+'</b>，剔除 <b class="num-red">'+removed+'个</b>，剩余 <b class="num-green">'+keep.length+'个</b>，月损失由 '+wan(lossBefore)+' 调整为 <b>'+wan(lossAfter)+'</b>。下一步？',
      [{label:'看这批的GMV占比', onclick:function(){ nextIntent('analyze'); }},
       {label:'继续筛选', onclick:function(){ SESSION.slots.refineField=null; addUser('继续筛选'); delay(runRefine); }},
       {label:'制定改善目标', onclick:function(){ nextIntent('target'); }}],
      [{type:'think',text:'意图=结果二次筛选。作用对象=上一步命中结果集（'+base.length+'个）。\n筛选条件='+f.label+'，模式='+(mode==='exclude'?'剔除匹配项':'仅保留匹配项')+'。\n对结果集按字段过滤后重算命中数与月损失。'},
       {type:'tool',text:'Skill: result_set_refine(field='+f.f+', op='+f.op+', value='+f.v+', mode='+mode+')\nTool: filter_hits(lastHits) → '+keep.length+' 个'}], card);
  });
}
/* ============ 意图：占比/构成分析（异常SKU的GMV占某基准比例） ============ */
var RATIO_LABEL={ all:'全量托管商品', dept:'所属事业部', cat:'所属品类', scope:'本次圈品范围' };
function baseSetFor(ratioBase,hits){
  if(ratioBase==='all') return SKUS;
  if(ratioBase==='dept'){ var depts={}; hits.forEach(function(s){depts[s.dept]=1;}); return SKUS.filter(function(s){return depts[s.dept];}); }
  if(ratioBase==='cat'){ var cats={}; hits.forEach(function(s){cats[s.cat]=1;}); return SKUS.filter(function(s){return cats[s.cat];}); }
  return scopedSkus();
}
function runAnalyze(){
  var hits=currentResultSet();
  if(!hits){
    addAI('占比分析需要先有一份异常SKU结果。请先执行采购价诊断。',
      [{label:'去做采购价诊断', onclick:function(){ nextIntent('diagnose'); }}]);
    return;
  }
  var rb=SESSION.slots.ratioBase;
  if(!rb){
    addAI('我理解您想看这 <b>'+hits.length+'个</b>异常SKU的 <b>GMV占比</b>。请选择<b>对比基准</b>（占谁的大盘）：',
      [{label:'占全量托管商品', onclick:function(){ SESSION.slots.ratioBase='all'; addUser('占全量托管商品'); delay(runAnalyze); }},
       {label:'占所属事业部', onclick:function(){ SESSION.slots.ratioBase='dept'; addUser('占所属事业部'); delay(runAnalyze); }},
       {label:'占所属品类', onclick:function(){ SESSION.slots.ratioBase='cat'; addUser('占所属品类'); delay(runAnalyze); }},
       {label:'占本次圈品范围', onclick:function(){ SESSION.slots.ratioBase='scope'; addUser('占本次圈品范围'); delay(runAnalyze); }}],
      [{type:'intent',text:'意图=占比/构成分析。作用对象=异常SKU结果集（'+hits.length+'个）。缺少「对比基准」，触发参数级澄清。'}]);
    return;
  }
  setPlan(['定位异常集与基准集','汇总GMV','计算占比','结果呈现']);
  addSkill('gmv_ratio_analysis','GMV占比分析'); advancePlan(); advancePlan();
  var baseSet=baseSetFor(rb,hits);
  var hitGmv=hits.reduce(function(a,s){return a+s.gmv90;},0);
  var baseGmv=baseSet.reduce(function(a,s){return a+s.gmv90;},0);
  var ratio=baseGmv? (hitGmv/baseGmv*100):0;
  var cntRatio=baseSet.length? (hits.length/baseSet.length*100):0;
  advancePlan();
  var byCat={}; hits.forEach(function(s){ byCat[s.cat]=(byCat[s.cat]||0)+s.gmv90; });
  var catRows=Object.keys(byCat).sort(function(a,b){return byCat[b]-byCat[a];}).slice(0,6).map(function(c){
    return '<tr><td>'+esc(c)+'</td><td>'+wan(byCat[c])+'</td><td>'+(hitGmv?(byCat[c]/hitGmv*100).toFixed(1):0)+'%</td></tr>'; }).join('');
  delay(function(){ advancePlan();
    var card='<div class="mini-card"><div class="mini-title">&#128200; GMV占比分析 · 异常SKU vs '+RATIO_LABEL[rb]+'</div><div class="mini-metrics">'+
      '<div class="mm"><div class="v num-red">'+hits.length+'</div><div class="l">异常SKU</div></div>'+
      '<div class="mm"><div class="v">'+wan(hitGmv)+'</div><div class="l">异常90天GMV</div></div>'+
      '<div class="mm"><div class="v">'+wan(baseGmv)+'</div><div class="l">基准GMV</div></div>'+
      '<div class="mm"><div class="v num-red">'+ratio.toFixed(1)+'%</div><div class="l">GMV占比</div></div></div>'+
      '<div style="font-size:13px;color:#3d424b;margin:8px 0">异常SKU数量占基准 <b>'+cntRatio.toFixed(1)+'%</b>，GMV占比达 <b class="num-red">'+ratio.toFixed(1)+'%</b>'+(ratio>cntRatio?'，说明异常集中在<b>高GMV商品</b>，治理杠杆更高。':'。')+'</div>'+
      '<table><thead><tr><th>品类</th><th>异常GMV</th><th>占异常总GMV</th></tr></thead><tbody>'+catRows+'</tbody></table></div>';
    addProduct('GMV占比分析_'+RATIO_LABEL[rb]+'.xlsx');
    addAI('占比分析完成：这 <b>'+hits.length+'个</b>异常SKU 过去90天GMV为 <b>'+wan(hitGmv)+'</b>，占 <b>'+RATIO_LABEL[rb]+'</b>（'+baseSet.length+'个SKU / '+wan(baseGmv)+'）的 <b class="num-red">'+ratio.toFixed(1)+'%</b>。数量占比 '+cntRatio.toFixed(1)+'%。下一步？',
      [{label:'换个对比基准', onclick:function(){ SESSION.slots.ratioBase=null; addUser('换个基准'); delay(runAnalyze); }},
       {label:'制定改善目标', onclick:function(){ nextIntent('target'); }},
       {label:'二次筛选结果', onclick:function(){ SESSION.slots.refineField=null; nextIntent('refine'); }}],
      [{type:'think',text:'意图=占比/构成分析。\n异常集=当前结果集（'+hits.length+'个），基准集='+RATIO_LABEL[rb]+'（'+baseSet.length+'个）。\n分别汇总90天GMV后求比值，并对比数量占比判断异常是否集中在高GMV商品。'},
       {type:'tool',text:'Tool: sum_gmv(hits,90d)='+wan(hitGmv)+'\nTool: sum_gmv(base='+rb+',90d)='+wan(baseGmv)+'\nSkill: gmv_ratio_analysis → '+ratio.toFixed(1)+'%'}], card);
  });
}
/* 意图2：异常归因 */
function runAttribute(){
  var hits=SESSION.lastHits.length?SESSION.lastHits:scopedSkus().filter(hitOf); SESSION.lastHits=hits;
  setPlan(['提取命中SKU','趋势对比归因','性质判断','结果呈现']);
  addSkill('problem_attribution','问题归因'); addSkill('anomaly_nature','异常性质判断'); addDoc('归因规则.yaml');
  advancePlan(); advancePlan(); advancePlan();
  var byPur=0,bySale=0,persist=0;
  hits.forEach(function(s){ var a=attrOf(s),n=natOf(s); if(a.t==='purchase')byPur++; if(a.t==='sale')bySale++; if(n.t==='persist')persist++; });
  var rows=hits.slice(0,12).map(function(s){ var a=attrOf(s),n=natOf(s);
    var tag=a.t==='purchase'?'tag-red':(a.t==='sale'?'tag-blue':'tag-gray');
    return '<tr><td><b>'+s.name+'</b><br><span style="color:#a0a4ab">'+s.owner+'</span></td><td>采购'+s.purTrend+' / 售价'+s.salePriceTrend+'</td><td><span class="tag '+tag+'">'+a.l+'</span></td><td>'+(n.t==='persist'?'<span class="num-red">'+n.l+'（'+s.durationDays+'天）</span>':n.l+'（'+s.durationDays+'天）')+'</td></tr>'; }).join('')+(hits.length>12?'<tr><td colspan="4" style="text-align:center;color:#8a9099">…共 '+hits.length+' 个，仅展示前 12 个</td></tr>':'');
  delay(function(){ advancePlan();
    var card='<div class="mini-card"><div class="mini-title">&#128269; 归因分析结果</div><div class="mini-metrics">'+
      '<div class="mm"><div class="v num-red">'+byPur+'</div><div class="l">采购价问题</div></div>'+
      '<div class="mm"><div class="v num-blue">'+bySale+'</div><div class="l">销售价问题</div></div>'+
      '<div class="mm"><div class="v">'+(hits.length-byPur-bySale)+'</div><div class="l">综合问题</div></div>'+
      '<div class="mm"><div class="v num-red">'+persist+'</div><div class="l">持续性异常</div></div></div>'+
      '<table><thead><tr><th>SKU</th><th>价格趋势</th><th>问题归因</th><th>异常性质</th></tr></thead><tbody>'+rows+'</tbody></table></div>';
    addProduct('归因分析报告.xlsx');
    addAI('归因完成：<b class="num-red">'+byPur+'个</b>采购价问题、<b class="num-blue">'+bySale+'个</b>销售价问题，其中 <b>'+persist+'个</b>为持续性异常需优先处理。<br><br>下一步？',
      [{label:'制定改善目标与优先级', onclick:function(){ nextIntent('target'); }},
       {label:'仅导出归因报告', onclick:function(){ addUser('导出归因报告'); delay(function(){ addAI('归因报告已导出至右侧产物区。'); }); }}],
      [{type:'think',text:'对每个命中SKU做归因与性质判断：\n· 采购价上升且售价未降 → 采购价问题\n· 采购稳定且售价下降 → 销售价问题\n· 连续命中≥7天 → 持续性异常，优先治理'},
       {type:'tool',text:'Skill: problem_attribution + Model: anomaly_nature\nTool: query_price_trend(sku,90d)\nTool: query_hit_duration(sku)'}], card);
  });
}
/* 意图3：制定改善目标与优先级 */
function runTarget(){
  var hits=SESSION.lastHits.length?SESSION.lastHits:scopedSkus().filter(hitOf); SESSION.lastHits=hits;
  delay(function(){
    addAI('制定改善目标前，请确认 <b>优先级排序口径</b>：',
      [{label:'按GMV贡献排序（保大盘）', onclick:function(){ SESSION.priority='gmv'; addUser('按GMV贡献排序'); delay(function(){ targetResult(hits); }); }},
       {label:'按前毛损失排序（快止血）', onclick:function(){ SESSION.priority='loss'; addUser('按前毛损失排序'); delay(function(){ targetResult(hits); }); }}],
      [{type:'intent',text:'意图=制定改善目标；缺少必填参数「优先级口径」，触发参数级澄清（策略①参数层）。'}]);
  });
}
function targetResult(hits){
  setPlan(['目标价推荐','优先级排序','结果呈现']); addSkill('target_price_recommend','目标价推荐'); addSkill('priority_ranking','优先级排序');
  advancePlan(); advancePlan();
  var arr=hits.slice().sort(function(a,b){ return SESSION.priority==='gmv'?b.gmv90-a.gmv90:lossOf(b)-lossOf(a); });
  var p0=Math.max(1,Math.ceil(arr.length*0.2)), p1=Math.ceil(arr.length*0.5);
  var rows=arr.slice(0,12).map(function(s,i){ var target=benchOf(s); var down=((s.purchase-target)/s.purchase*100).toFixed(1);
    var pri=i<p0?'<span class="tag tag-red">P0</span>':(i<p1?'<span class="tag tag-blue">P1</span>':'<span class="tag tag-gray">P2</span>');
    return '<tr><td>'+pri+'</td><td><b>'+s.name+'</b><br><span style="color:#a0a4ab">'+s.owner+'</span></td><td>'+fmt(s.purchase)+'</td><td class="num-green">'+fmt(target)+'</td><td class="num-green">↓'+down+'%</td><td>'+wan(lossOf(s))+'</td></tr>'; }).join('')+(arr.length>12?'<tr><td colspan="6" style="text-align:center;color:#8a9099">…共 '+arr.length+' 个（P0 '+p0+' 个 / P1 '+(p1-p0)+' 个 / P2 其余），仅展示前 12 个</td></tr>':'');
  delay(function(){ advancePlan();
    var card='<div class="mini-card"><div class="mini-title">&#127919; 改善目标（按'+(SESSION.priority==='gmv'?'GMV贡献':'前毛损失')+'排序）</div><table><thead><tr><th>优先级</th><th>SKU</th><th>现采购价</th><th>目标采购价</th><th>降幅</th><th>月损失</th></tr></thead><tbody>'+rows+'</tbody></table></div>';
    addProduct('改善目标清单.xlsx'); SESSION.targetArr=arr;
    addAI('已生成 <b>'+arr.length+'个SKU</b>的目标采购价与优先级（P0/P1/P2）。下一步？',
      [{label:'推送治理任务给采销', onclick:function(){ nextIntent('push'); }},
       {label:'调整优先级口径', onclick:function(){ nextIntent('target'); }}],
      [{type:'think',text:'目标采购价=对标价作为谈判锚点；优先级按'+(SESSION.priority==='gmv'?'GMV':'损失')+'降序。'},
       {type:'tool',text:'Skill: target_price_recommend + Model: target_price_model\nSkill: priority_ranking'}], card);
  });
}
/* ============ 意图4：推送治理任务（支持即时按维度汇总 + 图片/HTML + 京Me触达） ============ */
// 待治理商品池：优先用目标清单，否则用命中结果
function govPool(){
  if(SESSION.targetArr&&SESSION.targetArr.length) return SESSION.targetArr;
  if(SESSION.lastHits&&SESSION.lastHits.length) return SESSION.lastHits;
  return scopedSkus().filter(hitOf);
}
// 优先级：按损失排序后 P0/P1/P2
function priOf(s,rankArr){ var i=rankArr.indexOf(s); return i<Math.ceil(rankArr.length*0.2)?'P0':(i<Math.ceil(rankArr.length*0.5)?'P1':'P2'); }
// 分组聚合：dim = pri / cat / brand / marginTier
function groupBy(pool,dim){
  var ranked=pool.slice().sort(function(a,b){ return lossOf(b)-lossOf(a); });
  var g={};
  pool.forEach(function(s){
    var key;
    if(dim==='pri') key=priOf(s,ranked);
    else if(dim==='cat') key=s.cat;
    else if(dim==='brand') key=s.brand;
    else { var d=deviOf(s); key=d>0.10?'重度(偏离>10%)':(d>0.05?'中度(5%~10%)':(d>0?'轻度(0~5%)':'达标')); }
    (g[key]=g[key]||[]).push(s);
  });
  return g;
}
var DIM_LABEL={ pri:'优先级(P0/P1/P2)', cat:'品类', brand:'品牌', marginTier:'前毛分层区间' };
// 汇总行
function summaryRows(pool,dim){
  var g=groupBy(pool,dim), keys=Object.keys(g);
  var order=dim==='pri'?['P0','P1','P2']:(dim==='marginTier'?['重度(偏离>10%)','中度(5%~10%)','轻度(0~5%)','达标']:keys);
  order=order.filter(function(k){return g[k];}).concat(keys.filter(function(k){return order.indexOf(k)<0;}));
  return order.map(function(k){ var arr=g[k]; var loss=arr.reduce(function(a,s){return a+lossOf(s);},0);
    return { key:k, cnt:arr.length, loss:loss }; });
}
function runPush(){
  var pool=govPool();
  setPlan(['选择汇总维度','即时生成产物','京Me机器人触达']); addSkill('task_summary','治理任务汇总'); addSkill('report_render','产物即时渲染'); addSkill('joyme_bot_push','京Me机器人推送');
  advancePlan();
  SESSION.pushPool=pool; SESSION.pushDim='pri'; SESSION.pushFmt='image';
  delay(function(){
    addAI('共 <b class="num-red">'+pool.length+'个</b>待治理商品。推送前请选择<b>汇总维度</b>与<b>产物形式</b>，我将<b>即时生成</b>并通过京Me机器人触达。',
      null, [{type:'think',text:'推送治理任务不再写死为固定4张卡，而是按用户即时指定的维度（P0/P1、品类、品牌、前毛分层）动态汇总，并即时渲染为图片(360×500)或HTML后经京Me机器人发送。'}],
      renderPushConfig());
    bindPushConfig();
  });
}
function renderPushConfig(){
  var dims=[['pri','按 P0/P1 优先级'],['cat','按品类'],['brand','按品牌'],['marginTier','按前毛分层区间']];
  var h='<div class="clarify-card"><div class="cc-head">&#128228; 即时汇总配置</div><div class="cc-pane">';
  h+='<div class="cc-label">汇总维度（点选切换实时预览）</div><div class="push-dims">';
  dims.forEach(function(d){ h+='<div class="pd-chip'+(SESSION.pushDim===d[0]?' sel':'')+'" data-dim="'+d[0]+'">'+d[1]+'</div>'; });
  h+='</div>';
  h+='<div class="cc-label">产物形式</div><div class="fmt-pick">'+
     '<div class="fmt-btn'+(SESSION.pushFmt==='image'?' sel':'')+'" data-fmt="image"><span class="fb-ic">&#128444;</span>图片<div class="fb-sub">360 × 500 固定</div></div>'+
     '<div class="fmt-btn'+(SESSION.pushFmt==='html'?' sel':'')+'" data-fmt="html"><span class="fb-ic">&#128196;</span>HTML<div class="fb-sub">按需即时生成</div></div></div>';
  h+='<div class="cc-label">即时预览（维度：'+DIM_LABEL[SESSION.pushDim]+'）</div>';
  var rows=summaryRows(SESSION.pushPool,SESSION.pushDim);
  h+='<table><thead><tr><th>'+DIM_LABEL[SESSION.pushDim]+'</th><th>商品数</th><th>月损失</th></tr></thead><tbody>'+
     rows.map(function(r){ return '<tr><td>'+r.key+'</td><td>'+r.cnt+'</td><td class="num-red">'+wan(r.loss)+'</td></tr>'; }).join('')+'</tbody></table>';
  h+='</div><div class="cc-foot"><span class="cc-hint">共'+SESSION.pushPool.length+'个商品 · '+rows.length+'个分组</span>'+
     '<button class="cc-btn primary" data-act="gen">生成'+(SESSION.pushFmt==='image'?'图片':'HTML')+'并推送</button></div></div>';
  return h;
}
function bindPushConfig(){
  var cards=msgs.querySelectorAll('.clarify-card'); var card=cards[cards.length-1]; if(!card)return;
  function rerender(){ card.outerHTML=renderPushConfig(); bindPushConfig(); }
  card.querySelectorAll('.pd-chip').forEach(function(c){ c.onclick=function(){ SESSION.pushDim=c.dataset.dim; rerender(); }; });
  card.querySelectorAll('.fmt-btn').forEach(function(b){ b.onclick=function(){ SESSION.pushFmt=b.dataset.fmt; rerender(); }; });
  var gen=card.querySelector('[data-act="gen"]'); if(gen)gen.onclick=function(){ genAndPush(); };
}
// 即时生成产物 + 京Me 触达
function genAndPush(){
  advancePlan();
  var pool=SESSION.pushPool, dim=SESSION.pushDim, fmt=SESSION.pushFmt;
  var rows=summaryRows(pool,dim);
  addUser('按'+DIM_LABEL[dim]+'汇总，生成'+(fmt==='image'?'图片':'HTML')+'并京Me推送');
  delay(function(){
    var extra, prod;
    if(fmt==='image'){
      var dataUrl=buildSummaryImage(pool,dim,rows);
      prod='采购价治理汇总_'+DIM_LABEL[dim]+'_360x500.png'; addProduct(prod);
      extra='<div class="gen-card"><div class="gen-head">&#128444; 已生成图片<span class="gh-badge">360 × 500</span></div>'+
        '<div class="gen-body"><div class="gen-thumb" onclick="previewImg(\''+prod+'\')"><img src="'+dataUrl+'"></div>'+
        '<div class="gen-meta">维度：'+DIM_LABEL[dim]+'<br>商品：'+pool.length+' 个 · '+rows.length+' 组<br>尺寸：360×500（京Me图片消息规格）<div class="gen-actions"><span class="gen-btn" onclick="previewImg(\''+prod+'\')">放大预览</span></div></div></div></div>';
      IMG_STORE[prod]=dataUrl;
    } else {
      var html=buildSummaryHtml(pool,dim,rows);
      prod='采购价治理汇总_'+DIM_LABEL[dim]+'.html'; addProduct(prod);
      HTML_STORE[prod]=html;
      extra='<div class="gen-card"><div class="gen-head">&#128196; 已生成 HTML 报告<span class="gh-badge">即时渲染</span></div>'+
        '<div class="gen-body"><div class="gen-meta">维度：'+DIM_LABEL[dim]+'<br>商品：'+pool.length+' 个 · '+rows.length+' 组<br>内容：按您选择的维度即时生成<div class="gen-actions"><span class="gen-btn primary" onclick="previewHtml(\''+prod+'\')">打开预览</span></div></div></div></div>';
    }
    addAI('已按 <b>'+DIM_LABEL[dim]+'</b> 即时生成'+(fmt==='image'?'图片（360×500）':'HTML 报告')+'。确认后由京Me机器人推送给相关采销群：',
      [{label:'确认经京Me机器人推送', onclick:function(){ joymePush(fmt,dim,pool.length); }},
       {label:'换个维度重做', onclick:function(){ addUser('换个维度'); delay(runPush); }}],
      [{type:'tool',text:'Skill: task_summary(dim='+dim+') → '+rows.length+'组\nSkill: report_render(fmt='+fmt+(fmt==='image'?', 360x500':'')+')\n产物已沉淀至右侧产物区'}], extra);
  });
}
function joymePush(fmt,dim,cnt){
  advancePlan();
  addUser('确认推送');
  var groups=Math.max(1,summaryRows(SESSION.pushPool,SESSION.pushDim).length);
  delay(function(){
    addAI('京Me机器人已推送完成，相关采销可在群内直接查看'+(fmt==='image'?'图片':'HTML链接')+'并认领任务。',
      [{label:'查看改善进度与通晒', onclick:function(){ nextIntent('progress'); }},
       {label:'结束本轮，稍后跟踪', onclick:function(){ addUser('稍后跟踪'); delay(function(){ addAI('好的，任务已进入跟踪队列，改善后会主动通知您。'); }); }}],
      null,
      '<div class="jm-receipt">&#9989; 京Me 机器人「采购价治理助手」已向 <b>'+groups+' 个采销群</b>推送 '+(fmt==='image'?'图片消息':'HTML卡片消息')+'，覆盖 '+cnt+' 个治理商品（维度：'+DIM_LABEL[dim]+'）</div>');
    toast('京Me已推送 · '+cnt+'个商品');
  });
}
/* 意图5：改善进度查看+归因 */
function runProgress(){
  var hits=SESSION.lastHits.length?SESSION.lastHits:scopedSkus().filter(hitOf);
  if(!hits.length)hits=SKUS.slice(0,3);
  setPlan(['取两日快照','状态对比','改善归因','结果呈现']); addSkill('progress_review_attribution','改善进度查看+归因');
  addDoc('改善归因模型说明.md'); advancePlan(); advancePlan(); advancePlan();
  var improved=[
    {name:hits[0]?hits[0].name:'商品A', reason:'采购价降价', chg:hits[0]?fmt(hits[0].purchase)+' → '+fmt(benchOf(hits[0])):'—', tag:'tag-green', desc:'供应商已调价至对标价，前毛转正'},
    {name:hits[1]?hits[1].name:'商品B', reason:'销售价上涨', chg:hits[1]?fmt(hits[1].sale)+' → '+fmt(hits[1].sale*1.12):'—', tag:'tag-blue', desc:'售价上调12%，毛利恢复'},
    {name:hits[2]?hits[2].name:'商品C', reason:'商品下柜', chg:'—', tag:'tag-gray', desc:'商品已下柜，退出巡检口径'}
  ].slice(0,Math.max(1,Math.min(3,hits.length)));
  var still=Math.max(0,hits.length-improved.length);
  var rows=improved.map(function(m){ return '<tr><td><b>'+m.name+'</b></td><td><span class="tag '+m.tag+'">已改善</span></td><td>'+m.reason+'</td><td>'+m.chg+'</td><td style="color:#8a9099">'+m.desc+'</td></tr>'; }).join('');
  delay(function(){ advancePlan();
    var card='<div class="mini-card"><div class="mini-title">&#128200; 改善进度对比（预警日 2026-06-24 → 指定日 2026-07-01）</div><div class="mini-metrics">'+
      '<div class="mm"><div class="v num-green">'+improved.length+'</div><div class="l">已改善</div></div>'+
      '<div class="mm"><div class="v num-red">'+still+'</div><div class="l">仍异常</div></div>'+
      '<div class="mm"><div class="v num-green">'+Math.round(improved.length/hits.length*100)+'%</div><div class="l">改善率</div></div>'+
      '<div class="mm"><div class="v num-green">'+wan(hits.slice(0,improved.length).reduce(function(a,s){return a+lossOf(s);},0))+'</div><div class="l">已止损/月</div></div></div>'+
      '<table><thead><tr><th>SKU</th><th>状态</th><th>改善原因</th><th>价格变化</th><th>说明</th></tr></thead><tbody>'+rows+'</tbody></table></div>';
    addProduct('改善进度归因报告.xlsx');
    SESSION.progressData={ improved:improved, still:still, total:hits.length, rate:Math.round(improved.length/hits.length*100) };
    addAI('进度归因完成：<b class="num-green">'+improved.length+'个</b>已改善（采购价降价/售价上涨/下柜），改善率 <b class="num-green">'+Math.round(improved.length/hits.length*100)+'%</b>；仍有 <b class="num-red">'+still+'个</b>进入下一轮跟踪。本轮闭环完成。',
      [{label:'生成通晒报告（HTML）', onclick:function(){ addUser('生成通晒报告'); delay(broadcastConfig); }},
       {label:'跟踪剩余异常', onclick:function(){ addUser('跟踪剩余异常'); delay(function(){ addAI('好的，'+still+'个仍异常SKU已加入次日自动巡检队列，改善后主动通知。'); }); }}],
      [{type:'think',text:'对比预警日与指定日两个时点快照，识别状态变化并归因：采购价降价/销售价上涨/商品下柜/移出巡检范围；剩余仍异常进入下一轮。'},
       {type:'tool',text:'Skill: progress_review_attribution + Model: improvement_attribution\nTool: query_sku_snapshot(2026-06-24)\nTool: query_sku_snapshot(2026-07-01)\nTool: query_shelf_status(sku)'}], card);
  });
}
/* ============ 通晒报告：维度按用户输入指定，即时生成 HTML ============ */
var BC_DIMS=[
  {k:'overview', l:'整体概览', def:true},
  {k:'byOwner',  l:'按采销拆分'},
  {k:'byReason', l:'按改善原因'},
  {k:'byCat',    l:'按品类'},
  {k:'residual', l:'剩余异常明细'}
];
function broadcastConfig(){
  SESSION.bcSel=SESSION.bcSel||{overview:true};
  addSkill('report_broadcast','结果通晒'); addSkill('report_render','产物即时渲染');
  addAI('通晒报告支持<b>自定义维度</b>即时生成为 HTML。请勾选需要包含的维度（可多选），我按您的选择即时渲染：',
    null, [{type:'think',text:'通晒报告不再是固定模板，而是根据用户勾选的维度（整体概览/按采销/按原因/按品类/剩余异常）即时组装 HTML 内容。'}],
    renderBcCard());
  bindBcCard();
}
function renderBcCard(){
  var h='<div class="clarify-card"><div class="cc-head">&#128202; 通晒报告维度配置</div><div class="cc-pane">';
  h+='<div class="cc-label">选择通晒维度（多选）</div><div class="push-dims">';
  BC_DIMS.forEach(function(d){ var sel=SESSION.bcSel[d.k]?' sel':''; h+='<div class="pd-chip'+sel+'" data-k="'+d.k+'">'+d.l+'</div>'; });
  h+='</div></div><div class="cc-foot"><span class="cc-hint">已选 '+Object.keys(SESSION.bcSel).filter(function(k){return SESSION.bcSel[k];}).length+' 个维度</span>'+
     '<button class="cc-btn primary" data-act="genbc">生成 HTML 通晒报告</button></div></div>';
  return h;
}
function bindBcCard(){
  var cards=msgs.querySelectorAll('.clarify-card'); var card=cards[cards.length-1]; if(!card)return;
  function rerender(){ card.outerHTML=renderBcCard(); bindBcCard(); }
  card.querySelectorAll('.pd-chip').forEach(function(c){ c.onclick=function(){ var k=c.dataset.k; SESSION.bcSel[k]=!SESSION.bcSel[k]; rerender(); }; });
  var g=card.querySelector('[data-act="genbc"]'); if(g)g.onclick=function(){ genBroadcast(); };
}
function genBroadcast(){
  var dims=BC_DIMS.filter(function(d){return SESSION.bcSel[d.k];});
  if(!dims.length){ dims=[BC_DIMS[0]]; SESSION.bcSel.overview=true; }
  var html=buildBroadcastHtml(dims);
  var prod='采购价诊断治理通晒报告.html'; addProduct(prod); HTML_STORE[prod]=html;
  addUser('按 '+dims.map(function(d){return d.l;}).join('、')+' 生成通晒报告');
  delay(function(){
    addAI('已按您选择的 <b>'+dims.length+'个维度</b>（'+dims.map(function(d){return d.l;}).join('、')+'）即时生成 HTML 通晒报告。本轮采购价诊断治理闭环全部完成。',
      [{label:'打开通晒报告', onclick:function(){ previewHtml(prod); }},
       {label:'京Me推送给管理层', onclick:function(){ addUser('京Me推送'); delay(function(){ addAI('通晒报告 HTML 已经京Me机器人推送至管理层群，本轮闭环完成。如需开启新任务，直接输入诉求即可。'); toast('通晒报告已京Me推送'); }); }}],
      [{type:'tool',text:'Skill: report_broadcast(dims=['+dims.map(function(d){return d.k;}).join(',')+'])\nSkill: report_render(fmt=html) → 即时生成'}],
      '<div class="gen-card"><div class="gen-head">&#128202; 通晒报告（HTML）<span class="gh-badge">即时生成</span></div><div class="gen-body"><div class="gen-meta">维度：'+dims.map(function(d){return d.l;}).join('、')+'<br>内容：按您勾选的维度即时组装<div class="gen-actions"><span class="gen-btn primary" onclick="previewHtml(\''+prod+'\')">打开预览</span></div></div></div></div>');
  });
}
function buildBroadcastHtml(dims){
  var pd=SESSION.progressData||{improved:[],still:0,total:0,rate:0};
  var pool=(SESSION.pushPool&&SESSION.pushPool.length)?SESSION.pushPool:(SESSION.lastHits||[]);
  var secs='';
  dims.forEach(function(d){
    if(d.k==='overview'){
      secs+='<h2>整体概览</h2><div class="kpi"><div class="kb"><div class="v">'+pd.total+'</div><div class="l">纳入治理</div></div>'+
        '<div class="kb"><div class="v" style="color:#12a150">'+pd.improved.length+'</div><div class="l">已改善</div></div>'+
        '<div class="kb"><div class="v" style="color:#12a150">'+pd.rate+'%</div><div class="l">改善率</div></div>'+
        '<div class="kb"><div class="v" style="color:#cf1322">'+pd.still+'</div><div class="l">仍异常</div></div></div>';
    } else if(d.k==='byReason'){
      var rmap={}; pd.improved.forEach(function(m){ rmap[m.reason]=(rmap[m.reason]||0)+1; });
      secs+='<h2>按改善原因</h2><table><thead><tr><th>改善原因</th><th>商品数</th></tr></thead><tbody>'+
        Object.keys(rmap).map(function(k){ return '<tr><td>'+esc(k)+'</td><td>'+rmap[k]+'</td></tr>'; }).join('')+'</tbody></table>';
    } else if(d.k==='byOwner'){
      var omap={}; pool.forEach(function(s){ omap[s.owner]=(omap[s.owner]||0)+1; });
      secs+='<h2>按采销拆分</h2><table><thead><tr><th>采销</th><th>负责商品数</th></tr></thead><tbody>'+
        Object.keys(omap).slice(0,10).map(function(k){ return '<tr><td>'+esc(k)+'</td><td>'+omap[k]+'</td></tr>'; }).join('')+'</tbody></table>';
    } else if(d.k==='byCat'){
      var cmap={}; pool.forEach(function(s){ cmap[s.cat]=(cmap[s.cat]||0)+1; });
      secs+='<h2>按品类</h2><table><thead><tr><th>品类</th><th>商品数</th></tr></thead><tbody>'+
        Object.keys(cmap).map(function(k){ return '<tr><td>'+esc(k)+'</td><td>'+cmap[k]+'</td></tr>'; }).join('')+'</tbody></table>';
    } else if(d.k==='residual'){
      secs+='<h2>剩余异常明细</h2><p style="color:#8a9099;font-size:13px">仍有 '+pd.still+' 个商品未改善，已进入下一轮自动巡检队列。</p>';
    }
  });
  return '<!doctype html><html><head><meta charset="utf-8"><title>采购价治理通晒报告</title>'+
    '<style>body{font-family:-apple-system,"PingFang SC",sans-serif;margin:0;background:#f5f6fa;color:#1f2329}'+
    '.hd{background:linear-gradient(135deg,#e01c1c,#ff7a45);color:#fff;padding:22px 26px}.hd h1{margin:0;font-size:21px}.hd p{margin:6px 0 0;opacity:.9;font-size:13px}'+
    '.wrap{padding:20px 26px}.kpi{display:flex;gap:14px;margin:12px 0 6px}.kb{flex:1;background:#fff;border-radius:10px;padding:14px;text-align:center}'+
    '.kb .v{font-size:24px;font-weight:800}.kb .l{font-size:12px;color:#8a9099;margin-top:4px}'+
    'h2{font-size:15px;margin:20px 0 10px;border-left:3px solid #e01c1c;padding-left:8px}'+
    'table{width:100%;border-collapse:collapse;background:#fff;border-radius:10px;overflow:hidden;font-size:13px}'+
    'th,td{padding:10px 12px;text-align:left;border-bottom:1px solid #f0f1f3}th{background:#fafbfc;color:#8a9099}</style></head><body>'+
    '<div class="hd"><h1>采购价诊断治理 · 通晒报告</h1><p>治理周期：2026-06-24 → 2026-07-01 ｜ 供应链Agent 即时生成 ｜ 维度：'+dims.map(function(d){return d.l;}).join('、')+'</p></div>'+
    '<div class="wrap">'+secs+'</div></body></html>';
}

/* ==========================================================================
 * 综毛目标拆解仿真 · Mock 数据 & 三级测算引擎
 * 对齐《综毛目标拆解仿真方案-V1.md》L1/L2/L3
 * ========================================================================== */

/* -------- 3.1 基线财务盘（部门 × C3 × 财务科目） --------
   科目对齐《导出科目树_副本.XLSX》：
   REV(IN0009) / M_综(IN0118) / M_前(IN0125) / M_返(IN0082+IN0083+IN0086)
   / M_广(IN0117) / M_其(IN0116+IN0595) / C_采(IN0081)
   单位：万元 */
var GT_BASELINE = {
  '家纺家居事业部': {
    dept:'家纺家居事业部', c2:'C2-1001', period:'近28天',
    REV_0: 128500, M_综_0: 12850, M_前_0: 7067, M_返_0: 4497, M_广_0: 1156, M_其_0: 130, C_采_0: 96660,
    c3s: [
      { code:'C3-100121', name:'四件套', REV:38550, M_前:2313, M_返:1234, C_采:29100, supRatio:0.32, purRatio:0.30 },
      { code:'C3-100122', name:'冬被',   REV:24415, M_前:1587, M_返:1050, C_采:18300, supRatio:0.23, purRatio:0.19 },
      { code:'C3-100123', name:'毛巾',   REV:19275, M_前: 906, M_返: 675, C_采:14520, supRatio:0.15, purRatio:0.15 },
      { code:'C3-100131', name:'收纳',   REV:25700, M_前:1156, M_返: 810, C_采:19340, supRatio:0.18, purRatio:0.20 },
      { code:'C3-100141', name:'家具',   REV:20560, M_前:1105, M_返: 728, C_采:15400, supRatio:0.12, purRatio:0.16 }
    ]
  },
  '厨卫生活事业部': {
    dept:'厨卫生活事业部', c2:'C2-1002', period:'近28天',
    REV_0: 96200, M_综_0: 10101, M_前_0: 5290, M_返_0: 3271, M_广_0: 1443, M_其_0: 97, C_采_0: 72400,
    c3s: [
      { code:'C3-100211', name:'锅具',   REV:33670, M_前:1893, M_返:1177, C_采:25340, supRatio:0.34, purRatio:0.35 },
      { code:'C3-100212', name:'刀具',   REV:19240, M_前:1039, M_返: 654, C_采:14500, supRatio:0.22, purRatio:0.20 },
      { code:'C3-100213', name:'保温杯', REV:24050, M_前:1275, M_返: 802, C_采:18100, supRatio:0.28, purRatio:0.25 },
      { code:'C3-100214', name:'蒸锅',   REV:19240, M_前:1083, M_返: 638, C_采:14460, supRatio:0.16, purRatio:0.20 }
    ]
  },
  '个护清洁事业部': {
    dept:'个护清洁事业部', c2:'C2-1003', period:'近28天',
    REV_0: 84300, M_综_0: 9694, M_前_0: 4636, M_返_0: 2529, M_广_0: 2445, M_其_0: 84, C_采_0: 63500,
    c3s: [
      { code:'C3-100311', name:'洗衣液', REV:29505, M_前:1620, M_返: 885, C_采:22225, supRatio:0.30, purRatio:0.32 },
      { code:'C3-100312', name:'牙膏',   REV:20232, M_前:1131, M_返: 607, C_采:15250, supRatio:0.24, purRatio:0.22 },
      { code:'C3-100313', name:'沐浴露', REV:16860, M_前: 918, M_返: 505, C_采:12700, supRatio:0.20, purRatio:0.19 },
      { code:'C3-100314', name:'消毒液', REV:17703, M_前: 967, M_返: 532, C_采:13325, supRatio:0.26, purRatio:0.27 }
    ]
  }
};
var GT_DEPT_LIST = Object.keys(GT_BASELINE);

/* -------- L1 · 财务恒等换算 --------
   输入：dept, r_target(小数), 分摊 α(0=按采购金额占比 / 1=按返利额占比 / 0.5=加权)
   输出：每 C3 的 { REV, M_返_0, r_0, M_返_new, ΔM_返, ΔM_前, ΔC_采, new_M_前, new_前毛率 } */
function gtRunL1(dept, rTarget, alpha){
  var bl = GT_BASELINE[dept]; if(!bl) return null;
  var r0 = bl.M_返_0 / bl.REV_0;
  var M_返_new = bl.REV_0 * rTarget;
  var ΔM_返_total = bl.M_返_0 - M_返_new;
  var rows = bl.c3s.map(function(c){
    // 两口径分摊
    var share = alpha * c.supRatio + (1-alpha) * c.purRatio;
    var ΔM_返 = ΔM_返_total * share;
    return {
      code: c.code, name: c.name, REV: c.REV,
      M_返_0: c.M_返, r_0: c.M_返 / c.REV,
      share: share, ΔM_返: ΔM_返,
      M_返_new: c.M_返 - ΔM_返,
      ΔM_前: ΔM_返,           // 恒等
      ΔC_采: ΔM_返,           // 售价不变假设
      M_前_0: c.M_前, new_M_前: c.M_前 + ΔM_返,
      r_前_0: c.M_前 / c.REV, r_前_new: (c.M_前 + ΔM_返) / c.REV,
      C_采_0: c.C_采
    };
  });
  return {
    dept: dept, baseline: bl, r_0: r0, r_target: rTarget, alpha: alpha,
    M_返_0_total: bl.M_返_0, M_返_new_total: M_返_new, ΔM_返_total: ΔM_返_total,
    ΔM_前_total: ΔM_返_total, ΔC_采_total: ΔM_返_total,
    new_M_前_total: bl.M_前_0 + ΔM_返_total,
    new_前毛率: (bl.M_前_0 + ΔM_返_total) / bl.REV_0,
    old_前毛率: bl.M_前_0 / bl.REV_0,
    综毛率: bl.M_综_0 / bl.REV_0,    // 应恒等
    rows: rows
  };
}

/* -------- 3.2/3.3 SKU × 供应商候选池 --------
   为每个 C3 程序化生成一组候选 SKU（供 L2/L3 使用）*/
var GT_SKU_POOL_CACHE = {};
function gtGenSkuPool(c3code, count){
  if(GT_SKU_POOL_CACHE[c3code]) return GT_SKU_POOL_CACHE[c3code];
  var s = {v: seed(c3code+'sim')};
  // 通过 C3 编码定位 C2 / 品类 / 品牌池
  var meta = null;
  Object.keys(GT_BASELINE).forEach(function(dn){
    var bl = GT_BASELINE[dn];
    bl.c3s.forEach(function(c){ if(c.code===c3code) meta = { dept:dn, c2:bl.c2, c3:c }; });
  });
  if(!meta) return [];
  // 从 CAT_META 找匹配的品牌/词根
  var catKey = Object.keys(CAT_META).find(function(k){ return CAT_META[k].dept===meta.dept; }) || Object.keys(CAT_META)[0];
  var cm = CAT_META[catKey];
  var supStock = [
    {code:'SUP-A01', name:cm.brands[0]+'官方旗舰',   type:'品牌商',    replace:1, exclusive:0.85},
    {code:'SUP-A02', name:cm.brands[0]+'京东旗舰',   type:'授权经销商', replace:2, exclusive:0.50},
    {code:'SUP-B03', name:cm.brands[1]+'官方旗舰',   type:'品牌商',    replace:1, exclusive:0.80},
    {code:'SUP-B04', name:cm.brands[1]+'华北代理',   type:'授权经销商', replace:3, exclusive:0.30},
    {code:'SUP-C05', name:cm.brands[2]+'直营',       type:'品牌商',    replace:2, exclusive:0.65},
    {code:'SUP-C06', name:cm.brands[2]+'专营',       type:'贸易商',    replace:4, exclusive:0.20},
    {code:'SUP-D07', name:cm.brands[3]+'旗舰',       type:'品牌商',    replace:2, exclusive:0.55},
    {code:'SUP-D08', name:cm.brands[3]+'联合代理',   type:'贸易商',    replace:5, exclusive:0.15},
    {code:'SUP-E09', name:'华东优品(贸易)',           type:'贸易商',    replace:6, exclusive:0.10},
    {code:'SUP-E10', name:'环球优选(贸易)',           type:'贸易商',    replace:5, exclusive:0.12}
  ];
  var pool = [], N = count || 220;
  for(var i=0;i<N;i++){
    var brand = cm.brands[Math.floor(rnd(s)*cm.brands.length)];
    var word  = cm.words[Math.floor(rnd(s)*cm.words.length)];
    var sup   = supStock[Math.floor(rnd(s)*supStock.length)];
    var band  = ['一类货','二类货','三类货'][ Math.floor(rnd(s)*3) ];
    var lo=cm.base[0], hi=cm.base[1];
    var pref = +(lo + rnd(s)*(hi-lo)).toFixed(2);
    // 当前采购价 = 参考价 × (1 + 8~22% 溢价)
    var premium = 0.05 + rnd(s)*0.18;
    var pCur = +(pref * (1+premium)).toFixed(2);
    // 4 参考价
    var pModeMin = +(pref * (1 - rnd(s)*0.02)).toFixed(2);   // 多商最低
    var pInd     = +(pref * (1 + (rnd(s)-0.5)*0.03)).toFixed(2);  // 行业基准
    var pPOP     = +(pref * (0.94 + rnd(s)*0.05)).toFixed(2);  // POP
    var pHisMin  = +(pref * (0.96 + rnd(s)*0.03)).toFixed(2);
    var arr = [pModeMin, pInd, pPOP, pHisMin].sort(function(a,b){return a-b;});
    var pRef = +((arr[1]+arr[2])/2).toFixed(2);
    var Δp_max = Math.max(0, +(pCur - pRef).toFixed(2));
    // 5 特征
    var x1 = +rnd(s).toFixed(2);              // 近12月降价成功率 0~1
    var x2 = Math.floor(1 + rnd(s)*18);        // 距上次降价月数
    var x3 = sup.replace;
    var x4 = sup.exclusive;
    var x5 = sup.type==='品牌商' ? 1 : 0;
    // Logistic：先验权重
    var z = -1.2 + 1.8*x1 + 0.12*Math.min(x2,12)/12 + 0.20*x3 - 1.4*x4 - 0.9*x5;
    var s_neg = 1/(1+Math.exp(-z));
    s_neg = Math.max(0.05, Math.min(0.95, +s_neg.toFixed(2)));
    var Q28 = Math.floor(120 + rnd(s)*4200);
    var E_ΔC = Math.round(Δp_max * s_neg * Q28);   // 元
    var E_ΔC_low  = Math.round(Δp_max * Math.max(0, s_neg-0.15) * Q28);
    var E_ΔC_high = Math.round(Δp_max * Math.min(1, s_neg+0.15) * Q28);
    // 谈判成本（用于排序）
    var costNeg = 1*(1-s_neg) + 0.3*x5 + 0.5*(x4>0.6?1:0);
    var score = E_ΔC / Math.max(0.1, costNeg);
    pool.push({
      id: 'SKU-'+c3code.replace('C3-','')+'-'+String(i).padStart(3,'0'),
      name: brand+' '+word, brand: brand, c3: meta.c3.code, c3Name: meta.c3.name,
      supCode: sup.code, supName: sup.name, supType: sup.type, isBrand: x5===1,
      band: band, replace: sup.replace, exclusive: sup.exclusive,
      pCur: pCur, pModeMin: pModeMin, pInd: pInd, pPOP: pPOP, pHisMin: pHisMin,
      pRef: pRef, Δp_max: Δp_max, pTarget: +(pCur - Δp_max).toFixed(2),
      x1:x1, x2:x2, x3:x3, x4:x4, x5:x5,
      s_neg: s_neg, Q28: Q28, E_ΔC: E_ΔC, E_ΔC_low: E_ΔC_low, E_ΔC_high: E_ΔC_high,
      costNeg: +costNeg.toFixed(2), score: score,
      talkTag: (sup.type==='贸易商'?'替代威胁':(sup.type==='品牌商'?'季度联合谈判':'返利拆解'))
    });
  }
  // 按 score 降序
  pool.sort(function(a,b){ return b.score - a.score; });
  GT_SKU_POOL_CACHE[c3code] = pool;
  return pool;
}

/* -------- L3 · 分层贪心 --------
   输入：c3code, 目标降本额（元）, 配额 quota={one:0.4, two:0.3, three:0.2}, K=同供应商上限
   输出：{ selected, buckets, gap, suppliers, meta } */
function gtRunL3(c3code, targetYuan, quota, K){
  quota = quota || {one:0.40, two:0.30, three:0.20};
  K = K || 20;
  var pool = gtGenSkuPool(c3code);
  var buckets = { '一类货':[], '二类货':[], '三类货':[] };
  pool.forEach(function(p){ if(buckets[p.band]) buckets[p.band].push(p); });
  var quotaMap = { '一类货': targetYuan*quota.one, '二类货': targetYuan*quota.two, '三类货': targetYuan*quota.three };
  var selected = [], supCount = {};
  var accum = { '一类货':0, '二类货':0, '三类货':0 };
  // 每桶按 score 降序（gtGenSkuPool 已排序）
  Object.keys(buckets).forEach(function(b){ buckets[b].sort(function(a,c){ return c.score-a.score; }); });
  // 阶段1：按配额抢占
  Object.keys(buckets).forEach(function(b){
    for(var i=0;i<buckets[b].length;i++){
      if(accum[b] >= quotaMap[b]) break;
      var p = buckets[b][i];
      supCount[p.supCode] = supCount[p.supCode]||0;
      if(supCount[p.supCode] >= K) continue;
      selected.push(p); supCount[p.supCode]++; accum[b] += p.E_ΔC;
    }
  });
  // 阶段2：补充直至总目标
  var picked = {}; selected.forEach(function(p){ picked[p.id]=1; });
  var total = accum['一类货']+accum['二类货']+accum['三类货'];
  if(total < targetYuan){
    var remain = pool.filter(function(p){ return !picked[p.id]; });
    for(var j=0;j<remain.length && total<targetYuan; j++){
      var p = remain[j];
      supCount[p.supCode] = supCount[p.supCode]||0;
      if(supCount[p.supCode] >= K) continue;
      selected.push(p); supCount[p.supCode]++; accum[p.band] += p.E_ΔC; total += p.E_ΔC;
    }
  }
  // 汇总供应商
  var supMap = {};
  selected.forEach(function(p){
    var s = supMap[p.supCode]||(supMap[p.supCode]={ code:p.supCode, name:p.supName, type:p.supType, skus:0, save:0, snegSum:0 });
    s.skus++; s.save += p.E_ΔC; s.snegSum += p.s_neg;
  });
  var suppliers = Object.keys(supMap).map(function(k){
    var s = supMap[k]; s.avgSneg = +(s.snegSum/s.skus).toFixed(2);
    s.tier = (s.avgSneg>=0.6 && s.save>=500000) ? 'P0' : (s.avgSneg>=0.4 ? 'P1' : 'P2');
    return s;
  }).sort(function(a,b){ return b.save - a.save; });
  return {
    c3code: c3code, target: targetYuan, K: K, quota: quota,
    selected: selected, buckets: accum, total: total,
    gap: Math.max(0, targetYuan - total),
    suppliers: suppliers,
    supTierCount: suppliers.reduce(function(o,s){ o[s.tier]=(o[s.tier]||0)+1; return o; }, {})
  };
}

/* 供 HTML 引用 */
window.GT_BASELINE = GT_BASELINE;
window.GT_DEPT_LIST = GT_DEPT_LIST;
window.gtRunL1 = gtRunL1;
window.gtGenSkuPool = gtGenSkuPool;
window.gtRunL3 = gtRunL3;

/* ============ 输入发送与初始化 ============ */
(function init(){
  msgs=document.getElementById('msgs');
  var ta=document.getElementById('input'), btn=document.getElementById('sendBtn');
  function send(){ var v=(ta.value||'').trim(); if(!v)return; ta.value=''; ta.style.height='auto'; handleInput(v); }
  if(btn)btn.onclick=send;
  if(ta){ ta.addEventListener('keydown',function(e){ if(e.key==='Enter'&&!e.shiftKey){ e.preventDefault(); send(); } });
    ta.addEventListener('input',function(){ ta.style.height='auto'; ta.style.height=Math.min(ta.scrollHeight,120)+'px'; }); }
  var chips=['采购价预警改善结果','采购价异常识别诊断','综毛目标拆解与仿真'];
  var hc=document.getElementById('hintChips');
  hc.innerHTML=chips.map(function(c){ return '<span class="hint-chip">'+c+'</span>'; }).join('');
  hc.querySelectorAll('.hint-chip').forEach(function(c){
    c.onclick=function(){
      var t=c.textContent;
      if(t==='采购价预警改善结果' && typeof window.startImprovementReport==='function') window.startImprovementReport();
      else if(t==='采购价异常识别诊断' && typeof window.startAnomalyDiagnose==='function') window.startAnomalyDiagnose();
      else if(t==='综毛目标拆解与仿真' && typeof window.startGrossTarget==='function') window.startGrossTarget();
      else handleInput(t);
    };
  });
  if(typeof window!=='undefined' && typeof window.__mountHome==='function'){ window.__mountHome('all'); }
  addAI('您好，我是供应链小Y。我可以帮您完成三类采购价场景的分析：<br>· <b>采购价预警改善结果</b>——按您所属部门权限自动生成改善报告，全程在会话中调整维度、导出或推送；<br>· <b>采购价异常识别诊断</b>——查看部门当前命中的巡检规则，下钻商品范围，并支持基于规则或自定义策略仿真；<br>· <b>综毛目标拆解与仿真</b>——从综毛目标拆解到 C2 / C3 / 品类 / 品牌 / 采销，量化前毛/销售差/广告/返利四项贡献并做仿真。<br><br>点击下方快捷入口即可开始，也可以直接用一句话描述您的诉求。');
})();
