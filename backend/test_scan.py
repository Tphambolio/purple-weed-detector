"""End-to-end smoke test: scan a Drive folder with prefilter + Gemini."""
import asyncio
from models import WeedType
from scanner import scan_drive_folder

FOLDER = "https://drive.google.com/drive/folders/1AxvL7gY_hqY8SeswBxBzGGs3VqKlgncH?usp=drive_link"


async def main():
    print(f"Scanning: {FOLDER}\n")
    async for status in scan_drive_folder(FOLDER, [WeedType.ANY], force_rescan=True):
        if status.status == "error":
            print(f"ERROR: {status.current_file}")
            return
        if status.result is None:
            print(f"[{status.status}] total={status.total}")
            continue
        r = status.result
        marker = "*" if r.detected else ("." if r.status == "skipped" else "?")
        line = f"  {marker} [{status.processed:>2}/{status.total}] {r.filename:<40} {r.status:<10}"
        if r.detected:
            line += f" -> {r.species or '?'} ({r.confidence}) — {r.description}"
        elif r.status == "analyzed":
            line += f" -> not detected ({r.description})"
        print(line)
    print(f"\nDone. detected={status.detected}/{status.total}")


asyncio.run(main())
