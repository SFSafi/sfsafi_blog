export interface Media {
  id: string;
  storageKey: string;
  kind: 'image' | 'video';
  mimeType: string;
  byteSize: number;
  width: number;
  height: number;
  alt: string;
  caption?: string;
  thumbnailKey?: string;
  processingStatus: 'ready';
  createdAt: string;
  duration?: number;
}
export interface Post {
  id: string;
  kind: 'note' | 'article';
  title?: string;
  body: string;
  bodyFormat: 'plain';
  excerpt?: string;
  status: 'draft' | 'published' | 'archived';
  visibility: 'public';
  media: Media[];
  tags: string[];
  pinned: boolean;
  createdAt: string;
  updatedAt: string;
  firstPublishedAt?: string;
  revision: number;
  canonicalPath: string;
}
export interface Profile {
  name: string;
  handle: string;
  bio: string;
  location: string;
}
export interface ContentRepository {
  listPublished(options: {
    page: number;
    pageSize: number;
    kind?: Post['kind'];
    tag?: string;
  }): Promise<{ items: Post[]; hasMore: boolean }>;
  getPublished(id: string): Promise<Post | undefined>;
  getTags(): Promise<string[]>;
  getProfile(): Promise<Profile>;
  mediaUrl(media: Media): string;
}
const imageSizes: Record<string, number> = {
  landscape: 520,
  hills: 520,
  window: 659,
  flower: 520,
};
const image = (id: string, alt: string): Media => ({
  id,
  storageKey: `/media/${id}.svg`,
  kind: 'image',
  mimeType: 'image/svg+xml',
  byteSize: imageSizes[id] || 0,
  width: 1200,
  height: 900,
  alt,
  processingStatus: 'ready',
  createdAt: '2026-10-10T04:00:00Z',
});
const create = (
  id: string,
  body: string,
  tags: string[],
  date: string,
  extra: Partial<Post> = {},
): Post => ({
  id,
  body,
  tags,
  kind: 'note',
  bodyFormat: 'plain',
  status: 'published',
  visibility: 'public',
  media: [],
  pinned: false,
  createdAt: date,
  updatedAt: date,
  firstPublishedAt: date,
  revision: 1,
  canonicalPath: `/posts/${id}/`,
  ...extra,
});
const posts: Post[] = [
  create(
    'hello-space',
    '把日子写下来，把想法留在这里。\n\n这里是我的个人空间：一些生活片段，一些工程笔记，还有偶尔冒出来的灵感。不急着给每件事一个结论，先认真感受，再慢慢记录。\n\n欢迎你来坐坐。 ☕',
    ['日常', '随想'],
    '2026-10-13T01:00:00Z',
    { pinned: true },
  ),
  create(
    'afternoon-walk',
    '把下午留给一场没有目的地的散步。\n\n风从树梢穿过，光落在路上。离开屏幕一小会儿，才发现生活里还有这么多小小的细节。',
    ['日常', '散步'],
    '2026-10-12T07:24:00Z',
    {
      media: [
        image('landscape', '原创示例插画：湖边的山与夕阳'),
        image('window', '原创示例插画：窗边的一杯咖啡'),
        image('hills', '原创示例插画：连绵的绿山'),
      ],
    },
  ),
  create(
    'making-a-home',
    '网站可以很小，空间可以很大。\n\n我想做一个属于自己的角落，不被热度和数字追着走。用 Astro 搭一个轻巧的入口，把阅读体验和内容放在第一位。\n\n先把页面做好，再给内容找一个可靠的家。',
    ['工程笔记', 'Astro'],
    '2026-10-11T12:30:00Z',
    {
      kind: 'article',
      title: '给自己搭一个互联网小屋',
      excerpt: '从一张空白页面开始，让记录有一个安静、长久的去处。',
    },
  ),
  create(
    'flowers-in-motion',
    '今天的几秒钟，留给花和风。\n\n这是一个用于验证播放体验的公共领域视频示例。默认不自动播放，让你自己决定什么时候按下播放。',
    ['日常', '影像'],
    '2026-10-10T02:15:00Z',
    {
      media: [
        {
          ...image('flower', '风中的花朵'),
          kind: 'video',
          storageKey: '/media/flower.mp4',
          thumbnailKey: '/media/flower-poster.png',
          mimeType: 'video/mp4',
          byteSize: 1128375,
          width: 960,
          height: 540,
          duration: 5.055,
        },
      ],
    },
  ),
  create(
    'less-but-better',
    '最近在练习：少开一个标签页，少做一点无意义的比较。\n\n留一点空白，给真正想做的事。',
    ['随想'],
    '2026-10-09T08:00:00Z',
  ),
  create(
    'readable-web',
    '一个页面的舒适，常常藏在细节里。\n\n字号、行高、段落间距，决定我们愿不愿意多停留一分钟。做减法不是删掉所有东西，而是让重要的东西更容易被看见。\n\n给文字留出呼吸的空间。为图片写下描述。让键盘也能走遍每一处。',
    ['工程笔记', '设计'],
    '2026-10-08T03:00:00Z',
    {
      kind: 'article',
      title: '让页面慢下来，让文字被看见',
      excerpt: '关于留白、排版与一个更舒适的阅读体验。',
    },
  ),
  create(
    'weekend-list',
    '周末的小清单：\n\n读几页书，整理桌面，给植物浇水。\n不需要完成很多，也可以是很好的一天。',
    ['日常'],
    '2026-10-07T05:00:00Z',
  ),
  create(
    'private-draft',
    'DRAFT_SENTINEL_NEVER_PUBLIC',
    ['草稿'],
    '2026-10-14T00:00:00Z',
    { status: 'draft' },
  ),
];
const published = () =>
  posts
    .filter((p) => p.status === 'published' && p.visibility === 'public')
    .sort(
      (a, b) =>
        Number(b.pinned) - Number(a.pinned) ||
        Date.parse(b.firstPublishedAt!) - Date.parse(a.firstPublishedAt!),
    );
export const repository: ContentRepository = {
  async listPublished({ page, pageSize, kind, tag }) {
    const list = published().filter(
      (p) => (!kind || p.kind === kind) && (!tag || p.tags.includes(tag)),
    );
    const start = (page - 1) * pageSize;
    return {
      items: list.slice(start, start + pageSize),
      hasMore: start + pageSize < list.length,
    };
  },
  async getPublished(id) {
    return published().find((p) => p.id === id);
  },
  async getTags() {
    return [...new Set(published().flatMap((p) => p.tags))];
  },
  async getProfile() {
    return {
      name: 'SFSafi',
      handle: '@sfsafi',
      bio: '记录生活，也记录那些正在发生的想法。',
      location: '在互联网的一隅',
    };
  },
  mediaUrl(media) {
    return media.storageKey;
  },
};
export const formatDate = (date: string) =>
  new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(new Date(date));
export interface PublicationEvent {
  eventId: string;
  postId: string;
  revision: number;
  eventType:
    'first_published' | 'edited' | 'withdrawn' | 'archived' | 'republished';
  occurredAt: string;
}
export interface NotificationProvider {
  send(
    event: PublicationEvent,
    target: string,
  ): Promise<{ providerMessageId: string }>;
}
