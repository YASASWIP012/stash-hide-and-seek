// English and Simplified Chinese. English lives in index.html; Chinese replaces it on load.

export type Lang = 'en' | 'zh';

/** ?lang= wins, then the viewer's saved choice, then the browser language. */
export function detectLang(search: string, saved: string | null, browser: readonly string[]): Lang {
  const q = new URLSearchParams(search).get('lang');
  if (q === 'zh' || q === 'en') return q;
  if (saved === 'zh' || saved === 'en') return saved;
  return browser.some((l) => l.toLowerCase().startsWith('zh')) ? 'zh' : 'en';
}

export interface Messages {
  roomLoadFail: string;
  bootFail: string;
  loading: string;
  renderer3d: string;
  rendererPlan: string;
  stepHide: string;
  stepRobot: string;
  stepSeek: string;
  robotFound: (s: string) => string;
  robotGaveUp: string;
  robotBody: (n: number) => string;
  robotBodyNotFound: string;
  hiddenIn: (label: string) => string;
  youFoundBeat: (s: string) => string;
  youFound: (s: string) => string;
  seekBody: (robot: string, n: number) => string;
  copied: string;
  brokenLink: string;
  timeToBeat: (s: string) => string;
  genStart: string;
  genDone: (taskId: string) => string;
  genFail: (why: string) => string;
  placeholderRoom: string;
  realRoom: (owner: string | undefined, date: string) => string;
  noProv: string;
  provMeta: (taskId: string, credits: number, date: string) => string;
  provNote: (note: string) => string;
  urdfNote: (n: number, est: number) => string;
  planAria: string;
  openLabel: (label: string) => string;
  label: (english: string) => string;
  voice: Voice;
}

/** What the robot says during a replay. */
export interface Voice {
  think: (label: string, pct: string) => string;
  notIn: (label: string) => string;
  found: string;
  giveUp: string;
}

export const EN_VOICE: Voice = {
  think: (label, pct) => `${label}: ${pct} likely`,
  notIn: (label) => `Not in the ${label.toLowerCase()}.`,
  found: 'Found it.',
  giveUp: 'Out of time. I give up.',
};

const en: Messages = {
  roomLoadFail: 'This room could not be loaded. Try reloading the page.',
  bootFail: 'Something went wrong loading the room. Reload to try again.',
  loading: 'Loading',
  renderer3d: 'Aholo Viewer',
  rendererPlan: 'Floor plan (3D unavailable)',
  stepHide: 'Pick an object, then click a drawer, the wardrobe or the door to hide it.',
  stepRobot: 'The robot is searching. It opens the spot it rates best per second of effort.',
  stepSeek: 'Your friend hid something here. Click to open drawers and doors. The clock is running.',
  robotFound: (s) => `The robot found it in ${s} s.`,
  robotGaveUp: 'The robot ran out of time. You out-hid it.',
  robotBody: (n) => `It opened ${n} ${n === 1 ? 'spot' : 'spots'}. Send the hide to a friend and see if they beat the robot.`,
  robotBodyNotFound: 'Send the hide to a friend and see if a person does better.',
  hiddenIn: (label) => `Hidden in: ${label}. The robot starts in a moment.`,
  youFoundBeat: (s) => `You found it in ${s} s. You beat the robot.`,
  youFound: (s) => `You found it in ${s} s.`,
  seekBody: (robot, n) => `The robot needed ${robot} s on the same hide. You opened ${n} spots.`,
  copied: 'Copied',
  brokenLink: 'That link looks broken, so here is a fresh round instead.',
  timeToBeat: (s) => `Time to beat: the robot took ${s} s.`,
  genStart: 'Lux3D is generating your object. This usually takes 20 to 40 seconds.',
  genDone: (id) => `Done. Task ${id}. It is now selected: hide it in the room above.`,
  genFail: (why) => `Live generation is unavailable right now (${why}). The ready-made objects still work.`,
  placeholderRoom:
    'Placeholder room. The furniture is real Lux3D output, and its drawers and doors move on Lux3D joints. The room itself and its door are laid out by hand until the first phone scan is processed.',
  realRoom: (owner, date) => `Real room${owner ? ` from ${owner}` : ''}, scanned ${date}.`,
  noProv: 'No API results recorded for this room yet.',
  provMeta: (id, c, date) => `task ${id} · ${c} credit${c === 1 ? '' : 's'} · ${date}`,
  provNote: (note) => note,
  urdfNote: (n, est) => `${n} moving parts. ${est} of them have estimated joint limits, labelled as such inside the file.`,
  planAria: 'Floor plan of the room. Click a container to open it.',
  openLabel: (label) => `Open ${label}`,
  label: (s) => s,
  voice: EN_VOICE,
};

const ZH_LABELS: Record<string, string> = {
  Keys: '钥匙',
  Dresser: '斗柜',
  Nightstand: '床头柜',
  Wardrobe: '衣柜',
  'Dresser, top drawer': '斗柜上层抽屉',
  'Dresser, middle drawer': '斗柜中层抽屉',
  'Dresser, bottom drawer': '斗柜下层抽屉',
  'Nightstand drawer': '床头柜抽屉',
  'Behind the room door': '房门后面',
};

const zh: Messages = {
  roomLoadFail: '房间加载失败，请刷新页面重试。',
  bootFail: '加载房间时出错了，请刷新重试。',
  loading: '加载中',
  renderer3d: 'Aholo Viewer',
  rendererPlan: '平面图（3D 不可用）',
  stepHide: '选一件物品，然后点击抽屉、衣柜或房门，把它藏进去。',
  stepRobot: '机器人正在搜索。它总是先打开按所花时间算最有希望的位置。',
  stepSeek: '朋友在这里藏了东西。点击打开抽屉和门，计时已经开始。',
  robotFound: (s) => `机器人用 ${s} 秒找到了。`,
  robotGaveUp: '机器人没能在时限内找到。你藏得比它好。',
  robotBody: (n) => `它打开了 ${n} 个位置。把这次藏法发给朋友，看看谁能比机器人更快。`,
  robotBodyNotFound: '把这次藏法发给朋友，看看人能不能找得更快。',
  hiddenIn: (label) => `藏在：${label}。机器人马上开始找。`,
  youFoundBeat: (s) => `你用 ${s} 秒找到了，比机器人快。`,
  youFound: (s) => `你用 ${s} 秒找到了。`,
  seekBody: (robot, n) => `同一个藏法，机器人用了 ${robot} 秒。你打开了 ${n} 个位置。`,
  copied: '已复制',
  brokenLink: '这个链接好像坏了，先开一局新的吧。',
  timeToBeat: (s) => `要打败的时间：机器人用了 ${s} 秒。`,
  genStart: 'Lux3D 正在生成你的物品，通常需要 20 到 40 秒。',
  genDone: (id) => `完成，任务 ${id}。它已被选中，把它藏进上面的房间吧。`,
  genFail: (why) => `实时生成暂时不可用（${why}）。现成的物品照样能玩。`,
  placeholderRoom: '占位房间。家具是真实的 Lux3D 生成结果，抽屉和柜门靠 Lux3D 生成的关节活动。在第一段手机扫描处理完成之前，房间本身和房门是手工布置的。',
  realRoom: (owner, date) => `真实房间${owner ? `，来自 ${owner}` : ''}，扫描于 ${date}。`,
  noProv: '这个房间还没有记录任何 API 结果。',
  provMeta: (id, c, date) => `任务 ${id} · ${c} 积分 · ${date}`,
  provNote: (note) => {
    const m = note.match(/^Lux3D Turbo text-to-3D, size by aiPredictSize: (.*)$/);
    if (m) return `Lux3D Turbo 文生 3D，尺寸由 aiPredictSize 预测。提示词：${m[1]}`;
    const zhNotes: [string, string][] = [
      ['Lux3D part split of the dresser', 'Lux3D 部件拆分：把斗柜的三个抽屉从柜体上分离出来'],
      ['Lux3D articulation of the split dresser', 'Lux3D 关节生成：为拆分后的斗柜生成三个滑动关节（轴和行程），以 URDF 返回'],
      ['Lux3D part split of the nightstand', 'Lux3D 部件拆分：把床头柜的抽屉从柜体上分离出来'],
      ['Lux3D articulation of the split nightstand', 'Lux3D 关节生成：为拆分后的床头柜生成一个滑动关节，以 URDF 返回'],
      ['Lux3D part split of the wardrobe', 'Lux3D 部件拆分：把衣柜的两扇门从柜体上分离出来'],
      ['Lux3D articulation of the split wardrobe', 'Lux3D 关节生成：为拆分后的衣柜生成两个沿外侧边的铰链关节，以 URDF 返回'],
    ];
    for (const [en, zhNote] of zhNotes) if (note.startsWith(en)) return zhNote;
    return note;
  },
  urdfNote: (n, est) => `共 ${n} 个可活动部件，其中 ${est} 个的关节限位是估计值，文件里已注明。`,
  planAria: '房间平面图。点击家具即可打开。',
  openLabel: (label) => `打开${label}`,
  label: (s) => ZH_LABELS[s] ?? s,
  voice: {
    think: (label, pct) => `${label}：可能性 ${pct}`,
    notIn: (label) => `不在${label}。`,
    found: '找到了。',
    giveUp: '时间到，我放弃了。',
  },
};

export const MESSAGES: Record<Lang, Messages> = { en, zh };

/** Chinese for the static page. Keys match data-i18n attributes in index.html. */
export const ZH_HTML: Record<string, string> = {
  title: 'Stash：把东西藏进真实房间，比机器人藏得更好',
  'nav.play': '玩',
  'nav.how': '制作过程',
  'nav.export': '机器人导出',
  'nav.proof': '玩家',
  'nav.faq': '哪些是真的',
  'nav.cta': '开始玩',
  'hero.badge': '用 Aholo Lux3D 制作',
  'hero.h1': '把东西藏进真实房间。<span class="t-muted">然后比机器人藏得更好。</span>',
  'hero.lead': '选一件东西，塞进抽屉，机器人就会来找。它一次打开一个抽屉或一扇门，并显示它对每个位置有多大把握。把这次藏法发给朋友，看谁找得更快。',
  'hero.cta1': '玩示例房间',
  'hero.cta2': '看看怎么做的',
  'hero.trust': '<span>无需注册</span><span>在浏览器里运行</span><span>回放已保存的 Lux3D 结果，不用等服务器</span>',
  'game.title': 'Stash · 示例卧室',
  'game.loading': '加载中',
  'game.instructions': '正在加载房间。',
  'panel.todo': '怎么玩',
  'panel.object': '要藏的物品',
  'panel.odds': '机器人估计的概率',
  'panel.oddsNote': '概率由家具的大小和类型决定，并根据大家在这个房间里的藏法微调。',
  'panel.copy': '复制链接',
  'panel.again': '再藏一次',
  'how.eyebrow': '<span class="dot"></span>制作过程',
  'how.h2': '每件家具都是 3D 模型。<span class="t-muted">抽屉靠关节活动。</span>',
  'how.lead': '一张平面图片是打不开的。Stash 需要真正的 3D 几何体，拆分成部件，并给每个活动部件加上关节。这正是 Lux3D 在这里做的事。',
  'how.t1':
    '<span class="status status--next">下一步：第一次真实扫描</span><p class="t-title">1. 手机视频变成 3D 房间</p><p>一段 60 秒的 iPhone 视频交给 Aholo Reality，生成房间的 3D 高斯泼溅（3DGS）模型。</p>',
  'how.t2':
    '<span class="status status--next">计划中</span><p class="t-title">2. 识别家具</p><p>Spatial Understanding（空间理解）读取扫描，给出墙、门，以及每件家具的 3D 包围盒。</p>',
  'how.t3':
    '<span class="status status--done">已在使用</span><p class="t-title">3. Lux3D 生成每件家具</p><p>Lux3D 按真实尺寸生成带纹理的模型，尺寸来自它自带的尺寸预测。</p>',
  'how.t4': '<span class="status status--done">所有家具已完成</span><p class="t-title">4. 拆分部件</p><p>Lux3D 部件拆分把抽屉面板和柜门从柜体上分离出来。</p>',
  'how.t5':
    '<span class="status status--done">所有家具已完成</span><p class="t-title">5. 添加关节</p><p>Lux3D 关节生成把每个部件变成可滑动或可转动的关节，游戏和机器人用的是同一套关节。</p>',
  'how.t6':
    '<span class="status status--done">已在使用</span><p class="t-title">6. 藏、找、分享</p><p>机器人基于这些关节规划搜索。同一套关节还能导出为 URDF，供机器人仿真器使用。</p>',
  'how.saved': '这个房间回放的已保存结果',
  'try.eyebrow': '<span class="dot"></span>试试实时生成',
  'try.title': '藏你自己的物品',
  'try.body': '输入一个小物件。Lux3D 会把文字变成 3D 模型，并加入上面的物品列表。每天有次数上限；用完之后，现成的物品照样能玩。',
  'try.button': '生成',
  'export.eyebrow': '<span class="dot"></span>机器人导出',
  'export.title': '把房间带进机器人仿真器',
  'export.body': '把房间下载为 URDF：每个活动部件一个 link，带关节类型、轴和限位。估计而非实测的限位，会在文件里注明。',
  'export.button': '下载 URDF',
  'proof.eyebrow': '<span class="dot"></span>谁玩过',
  'proof.h2': '真实的房间和玩家，附日期。',
  'proof.lead': '每一条都对应一位拍摄了房间或玩过一局的人，只在本人同意后列出。',
  'proof.empty': '<span class="prov__what">还没有外部玩家。有人玩过之后会出现在这里。</span>',
  'faq.h2': '哪些是真的，哪些还不是。',
  'faq.1':
    '<summary>这是真实房间吗？</summary><p>还不是。示例房间是手工布置的占位房间。里面的家具是真实的 Lux3D 生成结果，由文字生成，尺寸来自 Lux3D 的尺寸预测。第一个用手机视频扫描的房间会替换它。</p>',
  'faq.2':
    '<summary>抽屉真的能动吗？</summary><p>能。它们靠关节活动，每个关节都有类型、轴和限位。斗柜的三个抽屉、床头柜抽屉和衣柜的两扇门都是 Lux3D 部件拆分得到的部件，关节来自 Lux3D 关节生成：斗柜抽屉能拉出约 0.33 米，床头柜抽屉 0.20 米，衣柜门沿外侧边转动四分之一圈（提示词里要求了大约四分之一圈）。只有房门仍是方块，限位是估计值，页面和机器人文件里都有注明。</p>',
  'faq.3':
    '<summary>机器人是 AI 吗？</summary><p>它是一个模拟机器人，搜索规则是公开的：先打开按所花时间算最有希望的位置，没找到就排除。它的概率从家具大小和类型出发，再根据记录下来的藏法调整。除此之外，它不会学习。</p>',
  'faq.4': '<summary>玩要花钱吗？</summary><p>不用。游戏回放的是已保存的结果。只有可选的实时生成会调用 API，而且每天有上限。</p>',
  'faq.5': '<summary>我的藏法会怎么处理？</summary><p>它们只保存在你的浏览器里，用来为你微调机器人的概率，不会发送到任何服务器。</p>',
  'footer.made': 'Stash。为 Manycore Aholo Global 3D AI Hackathon 制作。',
  'footer.status': '运行状态',
  'footer.report': '项目报告（PDF）',
};

/** Chinese for attributes: [data-i18n-aria] and [data-i18n-ph]. */
export const ZH_ATTR: Record<string, string> = {
  'game.stage': '房间。拖动可环顾四周，点击抽屉或门来使用。',
  'panel.share': '这次藏法的链接',
  'try.input': '要生成的物品',
  'try.placeholder': '一个蓝色 U 盘',
};

/** Swap the static English for Chinese. English needs no work: it is the HTML. */
export function applyStatic(lang: Lang, root: Document = document) {
  root.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
  if (lang !== 'zh') return;
  root.title = ZH_HTML.title!;
  root.querySelectorAll<HTMLElement>('[data-i18n]').forEach((el) => {
    const v = ZH_HTML[el.dataset.i18n!];
    if (v !== undefined) el.innerHTML = v;
  });
  root.querySelectorAll<HTMLElement>('[data-i18n-aria]').forEach((el) => {
    const v = ZH_ATTR[el.dataset.i18nAria!];
    if (v !== undefined) el.setAttribute('aria-label', v);
  });
  root.querySelectorAll<HTMLInputElement>('[data-i18n-ph]').forEach((el) => {
    const v = ZH_ATTR[el.dataset.i18nPh!];
    if (v !== undefined) el.placeholder = v;
  });
}
