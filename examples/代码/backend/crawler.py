"""异步抓取多个网页标题，并发数受信号量限制。"""
from __future__ import annotations

import asyncio
import re
from dataclasses import dataclass, field
from typing import Iterable

import aiohttp

TITLE_RE = re.compile(r"<title[^>]*>(.*?)</title>", re.I | re.S)


@dataclass(slots=True)
class Result:
    url: str
    status: int | None = None
    title: str = ""
    errors: list[str] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return self.status == 200 and not self.errors


async def fetch(session: aiohttp.ClientSession, url: str, sem: asyncio.Semaphore) -> Result:
    result = Result(url)
    async with sem:
        try:
            async with session.get(url, timeout=aiohttp.ClientTimeout(total=10)) as resp:
                result.status = resp.status
                html = await resp.text(errors="ignore")
                if m := TITLE_RE.search(html):
                    result.title = " ".join(m.group(1).split())
        except (aiohttp.ClientError, asyncio.TimeoutError) as exc:
            result.errors.append(repr(exc))
    return result


async def crawl(urls: Iterable[str], concurrency: int = 5) -> list[Result]:
    sem = asyncio.Semaphore(concurrency)
    async with aiohttp.ClientSession(headers={"User-Agent": "demo-crawler/1.0"}) as session:
        return await asyncio.gather(*(fetch(session, u, sem) for u in urls))


if __name__ == "__main__":
    pages = ["https://www.python.org", "https://docs.python.org/3/", "https://pypi.org"]
    for r in asyncio.run(crawl(pages)):
        mark = "✓" if r.ok else "✗"
        print(f"{mark} {r.status or '---'} {r.url:<32} {r.title[:40]}")
