"""Research boss: web research through the free web AIs (no paid API)."""
from bosses.base_boss import BaseBoss
from workers.api_fetcher_worker import ApiFetcherWorker


class ResearchBoss(BaseBoss):
    name = "research_boss"
    workers = {
        "research": ApiFetcherWorker,
        "search": ApiFetcherWorker,
        "info": ApiFetcherWorker,
        "fetch": ApiFetcherWorker,
    }

    def handle(self, task: dict) -> str:
        return "Research: ask Gemini/DeepSeek/ChatGPT in parallel, first valid JSON wins"
