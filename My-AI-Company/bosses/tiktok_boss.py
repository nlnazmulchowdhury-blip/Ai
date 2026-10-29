"""TikTok boss: download -> cut -> upload pipeline for short video."""
from bosses.base_boss import BaseBoss
from workers.downloader_worker import DownloaderWorker
from workers.cutter_worker import CutterWorker
from workers.uploader_worker import UploaderWorker


class TiktokBoss(BaseBoss):
    name = "tiktok_boss"
    workers = {
        "download": DownloaderWorker,
        "cut": CutterWorker,
        "upload": UploaderWorker,
    }

    def handle(self, task: dict) -> str:
        return "TikTok pipeline: download clip, cut to short format, stage upload"
