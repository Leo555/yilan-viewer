/**
 * 简单的防抖搜索：输入停止 300ms 后再请求，并取消上一次未完成的请求。
 */
import { debounce } from './utils.js';

const API = 'https://api.github.com/search/repositories';
let controller = null;

export async function searchRepos(keyword, { perPage = 10 } = {}) {
  controller?.abort();
  controller = new AbortController();
  const url = new URL(API);
  url.searchParams.set('q', keyword);
  url.searchParams.set('per_page', String(perPage));

  const res = await fetch(url, { signal: controller.signal });
  if (!res.ok) throw new Error(`请求失败：${res.status}`);
  const { items } = await res.json();
  return items.map(({ full_name: name, stargazers_count: stars, html_url: link }) => ({ name, stars, link }));
}

class SearchBox extends HTMLElement {
  #input;
  #list;

  connectedCallback() {
    this.innerHTML = '<input type="search" placeholder="搜索仓库"><ol></ol>';
    this.#input = this.querySelector('input');
    this.#list = this.querySelector('ol');
    this.#input.addEventListener('input', debounce(() => this.update(), 300));
  }

  async update() {
    const q = this.#input.value.trim();
    if (!q) return this.#list.replaceChildren();
    try {
      const repos = await searchRepos(q);
      this.#list.replaceChildren(...repos.map((r) => {
        const li = document.createElement('li');
        li.textContent = `${r.name} ★${r.stars.toLocaleString()}`;
        return li;
      }));
    } catch (err) {
      if (err.name !== 'AbortError') console.error(err);
    }
  }
}

customElements.define('search-box', SearchBox);
