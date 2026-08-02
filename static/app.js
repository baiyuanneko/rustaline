// bynrust26 静态示例页逻辑：原生 fetch 调用后端 API，无任何框架。

// 把 JSON 响应渲染到指定 <pre> 元素，并按状态码着色
async function renderJson(el, response) {
  const body = await response.json();
  el.textContent = `HTTP ${response.status}\n${JSON.stringify(body, null, 2)}`;
  el.className = response.ok ? 'ok' : 'err';
}

// 页面加载即查询健康状态
async function loadHealth() {
  const el = document.getElementById('health-result');
  try {
    await renderJson(el, await fetch('/health'));
  } catch (err) {
    el.textContent = `请求失败：${err}`;
    el.className = 'err';
  }
}

// 演示：不带 token 调用受保护接口，预期返回 401 统一错误 JSON
async function callProtectedApi() {
  const el = document.getElementById('users-result');
  try {
    await renderJson(el, await fetch('/api/v1/users'));
  } catch (err) {
    el.textContent = `请求失败：${err}`;
    el.className = 'err';
  }
}

document.getElementById('call-users').addEventListener('click', callProtectedApi);
loadHealth();
