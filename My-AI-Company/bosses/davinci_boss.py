"""DaVinci boss: edit / grade / render workflows (ffmpeg-backed)."""
from bosses.base_boss import BaseBoss
from workers.cutter_worker import CutterWorker
from workers.api_fetcher_worker import ApiFetcherWorker


class DavinciBoss(BaseBoss):
    name = "davinci_boss"
    workers = {
        "cut": CutterWorker,
        "render": CutterWorker,
        "grade": CutterWorker,
        "research": ApiFetcherWorker,
    }

    def handle(self, task: dict) -> str:
        return "DaVinci workflow: cut/grade/render via ffmpeg, research via web AIs"
