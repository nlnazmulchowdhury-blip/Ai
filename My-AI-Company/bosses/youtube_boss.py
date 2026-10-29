"""YouTube boss: download -> cut -> upload pipeline."""
from bosses.base_boss import BaseBoss
from workers.downloader_worker import DownloaderWorker
from workers.cutter_worker import CutterWorker
from workers.uploader_worker import UploaderWorker


class YoutubeBoss(BaseBoss):
    name = "youtube_boss"
    workers = {
        "download": DownloaderWorker,
        "cut": CutterWorker,
        "upload": UploaderWorker,
    }

    def handle(self, task: dict) -> str:
        return "YouTube pipeline: download source, cut the wanted part, upload result"
