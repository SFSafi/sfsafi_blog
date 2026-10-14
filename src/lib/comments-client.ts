for (const section of document.querySelectorAll<HTMLElement>(
  '[data-comments]',
)) {
  const postId = section.dataset.postId!,
    list = section.querySelector<HTMLElement>('[data-comments-list]')!,
    status = section.querySelector<HTMLElement>('[data-comments-status]')!,
    more = section.querySelector<HTMLButtonElement>('[data-comments-more]')!,
    form = section.querySelector<HTMLFormElement>('[data-comment-form]')!,
    submit = form.querySelector<HTMLButtonElement>('[type=submit]')!,
    reply = form.querySelector<HTMLElement>('[data-comment-reply]')!,
    cancel = form.querySelector<HTMLButtonElement>(
      '[data-comment-cancel-reply]',
    )!;
  let page = 1,
    parentId: string | null = null,
    clientId = crypto.randomUUID(),
    busy = false,
    attempted = false;
  const nickname = form.elements.namedItem('nickname') as HTMLInputElement,
    body = form.elements.namedItem('body') as HTMLTextAreaElement;
  async function load() {
    more.disabled = true;
    try {
      const response = await fetch(
        '/api/comments?postId=' + encodeURIComponent(postId) + '&page=' + page,
        { signal: AbortSignal.timeout(10000) },
      );
      const data = await response.json();
      if (!response.ok) throw Error(data.error || '评论读取失败。');
      for (const comment of data.items) {
        const article = document.createElement('article'),
          head = document.createElement('strong'),
          text = document.createElement('p'),
          date = document.createElement('small');
        article.className = 'comment-item';
        article.id = 'comment-' + comment.id;
        head.textContent =
          comment.nickname + (comment.owner ? ' · 站主' : ' · 访客');
        text.textContent = comment.body;
        date.textContent = new Date(comment.created_at).toLocaleString('zh-CN');
        article.append(head, date);
        if (comment.parent_id) {
          const parent = document.createElement('a');
          parent.href = '#comment-' + comment.parent_id;
          parent.textContent = '回复上方评论';
          article.append(parent);
        }
        article.append(text);
        if (!comment.parent_id) {
          const button = document.createElement('button');
          button.type = 'button';
          button.textContent = '回复';
          button.addEventListener('click', () => {
            parentId = comment.id;
            reply.textContent = '回复 ' + comment.nickname;
            reply.hidden = false;
            cancel.hidden = false;
            clientId = crypto.randomUUID();
            body.focus();
          });
          article.append(button);
        }
        list.append(article);
      }
      more.hidden = !data.hasMore;
      page++;
      status.textContent = list.children.length
        ? '仅展示已审核评论。'
        : '还没有已审核评论。';
    } catch (error) {
      status.textContent =
        error instanceof Error ? error.message : '评论读取失败，请稍后重试。';
    } finally {
      more.disabled = false;
    }
  }
  more.addEventListener('click', () => {
    void load();
  });
  cancel.addEventListener('click', () => {
    parentId = null;
    clientId = crypto.randomUUID();
    reply.hidden = true;
    cancel.hidden = true;
  });
  form.addEventListener('input', () => {
    if (attempted && !busy) {
      clientId = crypto.randomUUID();
      attempted = false;
    }
  });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (busy) return;
    busy = true;
    attempted = true;
    nickname.disabled = true;
    body.disabled = true;
    cancel.disabled = true;
    submit.disabled = true;
    status.textContent = '正在提交…';
    try {
      const response = await fetch('/api/comments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          postId,
          nickname: nickname.value,
          body: body.value,
          parentId,
          clientId,
        }),
        signal: AbortSignal.timeout(10000),
      });
      const data = await response.json();
      if (!response.ok) throw Error(data.error || '提交失败。');
      body.value = '';
      attempted = false;
      parentId = null;
      reply.hidden = true;
      cancel.hidden = true;
      clientId = crypto.randomUUID();
      status.textContent = '评论已提交，审核通过后会显示。';
    } catch (error) {
      status.textContent =
        error instanceof Error ? error.message : '提交失败，请重试。';
    } finally {
      busy = false;
      nickname.disabled = false;
      body.disabled = false;
      cancel.disabled = false;
      submit.disabled = false;
    }
  });
  void load();
}
