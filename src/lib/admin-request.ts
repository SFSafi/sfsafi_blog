export async function adminRequest(path: string, body?: unknown) {
  const response = await fetch(path, {
    signal: AbortSignal.timeout(15000),
    ...(body === undefined
      ? {}
      : {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }),
  });
  if (!response.headers.get('Content-Type')?.includes('application/json'))
    throw Error(
      response.status >= 500
        ? '管理服务暂不可用，请稍后重试。'
        : '请通过站主邮箱登录；登录过期时请刷新页面。',
    );
  const data = await response.json();
  if (!response.ok) throw Error(data.error || '请求失败，请重试。');
  return data;
}
