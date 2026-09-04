/**
 * Demo personas with conversations and chat history. Text content lives here so
 * demo-seed.ts stays focused on persistence logic. `user` messages represent
 * inbound messages from the WeChat contact; `assistant` messages are the bot's
 * replies, rendered by the web conversation page from the same payload shape
 * the real pipeline writes (role + content blocks + timestamp).
 */

export interface DemoMessage {
  role: "user" | "assistant";
  text: string;
  /** Minutes since the previous message; drives createdAt staggering. */
  gapMin: number;
}

export interface DemoConversation {
  conversationId: string;
  title: string;
  /** Days before now when this conversation's first message happens. */
  startedDaysAgo: number;
  messages: DemoMessage[];
}

export interface DemoMemoryFact {
  key: string;
  value: string;
}

export interface DemoMemoryDecision {
  description: string;
  context: string;
}

export interface DemoPersona {
  accountId: string;
  displayName: string;
  alias: string;
  conversations: DemoConversation[];
  facts: DemoMemoryFact[];
  preferences: DemoMemoryFact[];
  decisions: DemoMemoryDecision[];
}

export const DEMO_ACCOUNT_PREFIX = "demo-wxid-";

export const DEMO_PERSONAS: DemoPersona[] = [
  {
    accountId: "demo-wxid-linxi",
    displayName: "林间小屋",
    alias: "林夕",
    conversations: [
      {
        conversationId: "demo-wxid-mama",
        title: "妈妈",
        startedDaysAgo: 3,
        messages: [
          { role: "user", text: "儿子，这周末回家吃饭吗？我炖汤", gapMin: 0 },
          { role: "assistant", text: "妈，这周末回不去，项目上线要盯着，下周一定回。", gapMin: 2 },
          { role: "user", text: "又是工作，你爸血压这两天有点高", gapMin: 4 },
          {
            role: "assistant",
            text: "他药按时吃着吗？我记得是早晚各一次。",
            gapMin: 1,
          },
          { role: "user", text: "吃着呢，就是他总忘", gapMin: 3 },
          {
            role: "assistant",
            text: "那我每天早上 8 点提醒你一句，让他先量个血压再吃药，好不好？",
            gapMin: 2,
          },
          { role: "user", text: "好好好，那太麻烦你了", gapMin: 5 },
          {
            role: "assistant",
            text: "不麻烦。冰箱不是报修了吗，师傅昨天上门修好了，你不用惦记。",
            gapMin: 2,
          },
          { role: "user", text: "那就好，你自己也别老熬夜", gapMin: 8 },
          { role: "assistant", text: "知道了，妈。降温了你也多穿点。", gapMin: 1 },
        ],
      },
      {
        conversationId: "5281133772@chatroom",
        title: "周末爬山群",
        startedDaysAgo: 2,
        messages: [
          { role: "user", text: "这周六爬山去不去？天气预报说晴天", gapMin: 0 },
          {
            role: "assistant",
            text: "去！我看过路线了，推荐走北线上古道，全程 6 公里、爬升 400 米，上午 8 点山门口集合。",
            gapMin: 3,
          },
          { role: "user", text: "带狗可以吗", gapMin: 6 },
          {
            role: "assistant",
            text: "可以，北线好走，宠物也多。记得带水，山上只有一处补给点。",
            gapMin: 2,
          },
          { role: "user", text: "我可能要晚到半小时，你们先出发", gapMin: 12 },
          {
            role: "assistant",
            text: "行，那集合时间改成 8 点半，等你一起出发。集合定位我稍后发群里。",
            gapMin: 1,
          },
          { role: "user", text: "下雨怎么办", gapMin: 40 },
          {
            role: "assistant",
            text: "周六目前预报多云。如果当天早上有雨，我会在群里通知改期到周日。",
            gapMin: 4,
          },
        ],
      },
    ],
    facts: [
      { key: "称呼", value: "林夕" },
      { key: "所在城市", value: "杭州" },
      { key: "父亲用药", value: "降压药，早晚各一次" },
    ],
    preferences: [
      { key: "回复风格", value: "简短直接，不啰嗦" },
      { key: "消息时间", value: "早上 8 点前不要推送" },
    ],
    decisions: [
      {
        description: "每个工作日早上 8 点提醒妈妈转告父亲量血压、按时吃药",
        context: "2026 年 8 月聊天中主动提出，妈妈确认后执行",
      },
    ],
  },
  {
    accountId: "demo-wxid-chenyu",
    displayName: "产品体验官·阿屿",
    alias: "阿屿",
    conversations: [
      {
        conversationId: "demo-wxid-ake",
        title: "设计同学 · 阿柯",
        startedDaysAgo: 2,
        messages: [
          { role: "user", text: "内测群今天的反馈你看了吗", gapMin: 0 },
          {
            role: "assistant",
            text: "看了，一共 12 条，集中在三件事：消息加载慢、记忆图谱看不懂、模型配置页想支持批量导入。",
            gapMin: 2,
          },
          { role: "user", text: "加载慢是哪端的问题", gapMin: 5 },
          {
            role: "assistant",
            text: "偏后端。会话列表接口在消息多的账号上要 1 秒以上，复现步骤和录屏我已经整理成文档发你邮箱了。",
            gapMin: 1,
          },
          { role: "user", text: "好，记忆图谱那个我明天出两版设计", gapMin: 20 },
          {
            role: "assistant",
            text: "赞。需要的话我把用户原话按问题标签整理一份给你，当设计依据。",
            gapMin: 2,
          },
          { role: "user", text: "要，晚上给我", gapMin: 1 },
          { role: "assistant", text: "没问题，晚上 7 点前发你。", gapMin: 1 },
        ],
      },
      {
        conversationId: "7396201841@chatroom",
        title: "ClawBot 内测群",
        startedDaysAgo: 1,
        messages: [
          { role: "user", text: "@ClawBot 帮我总结下今天群里的讨论", gapMin: 0 },
          {
            role: "assistant",
            text: "今天群里主要讨论了三件事：1）新版会话列表的加载速度；2）定时任务 cron 表达式的写法；3）下周三内测复盘会的时间。需要我展开哪一条吗？",
            gapMin: 1,
          },
          { role: "user", text: "复盘会定几点", gapMin: 3 },
          {
            role: "assistant",
            text: "目前大家倾向下午 3 点，还没有最终确认。人齐之后我会提醒发起人拍板。",
            gapMin: 1,
          },
          { role: "user", text: "这个机器人挺好用的", gapMin: 30 },
          {
            role: "assistant",
            text: "谢谢反馈！遇到消息丢失或回复奇怪的情况，直接在群里 @我 并附截图，我会记录下来。",
            gapMin: 1,
          },
          { role: "user", text: "@ClawBot 明天提醒我交周报", gapMin: 8 },
          {
            role: "assistant",
            text: "好的，明天（周四）晚上 9 点提醒你交周报，可以吗？还是改到白天？",
            gapMin: 1,
          },
          { role: "user", text: "白天吧，下午两点", gapMin: 2 },
          { role: "assistant", text: "已记下：明天下午 2 点提醒你交周报。", gapMin: 1 },
          { role: "user", text: "它真的能记住吗", gapMin: 15 },
          {
            role: "assistant",
            text: "已经写进定时提醒了，到点我会在这个群里发一条。到期没收到的话请戳我。",
            gapMin: 1,
          },
        ],
      },
    ],
    facts: [
      { key: "角色", value: "产品体验官，负责内测反馈收集" },
      { key: "协作对象", value: "设计同学阿柯" },
    ],
    preferences: [{ key: "汇报格式", value: "分要点列表，先结论后细节" }],
    decisions: [
      {
        description: "每周五 18:00 汇总内测群反馈并私聊发给阿柯",
        context: "与设计和研发的同步节奏，从 2026 年 8 月开始执行",
      },
    ],
  },
  {
    accountId: "demo-wxid-wanwan",
    displayName: "晚晚wanwan",
    alias: "晚晚",
    conversations: [
      {
        conversationId: "demo-wxid-laozhou",
        title: "跑步搭子 · 老周",
        startedDaysAgo: 4,
        messages: [
          { role: "user", text: "明早跑不跑", gapMin: 0 },
          {
            role: "assistant",
            text: "跑！6 点半老地方，滨江跑道南口。今早你最后两公里掉速了，明天前 3 公里我们压着 6'45'' 配速跑。",
            gapMin: 2,
          },
          { role: "user", text: "行，听你的", gapMin: 4 },
          {
            role: "assistant",
            text: "带瓶水，明天 26 度，比今天热。跑完我去买豆浆，老规矩两份。",
            gapMin: 1,
          },
          { role: "user", text: "加个蛋", gapMin: 1 },
          {
            role: "assistant",
            text: "哈哈行，两份豆浆加蛋。6 点 15 我在你家楼下等你。",
            gapMin: 1,
          },
          { role: "user", text: "别，我自己下去，你多睡会", gapMin: 2 },
          {
            role: "assistant",
            text: "那就 6 点 20 楼下见。今晚 11 点前睡，不然明早又赖床。",
            gapMin: 1,
          },
        ],
      },
    ],
    facts: [
      { key: "昵称", value: "晚晚" },
      { key: "晨跑安排", value: "每周二、四、六 6:30 滨江跑道" },
    ],
    preferences: [{ key: "配速提醒", value: "每公里报一次配速" }],
    decisions: [
      {
        description: "跑步日早上 6:00 发出门提醒，避免睡过头",
        context: "连续两次迟到后和老周约定",
      },
    ],
  },
];
