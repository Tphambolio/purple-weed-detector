"""One-shot smoke test: bootstrap Drive OAuth and list images in a folder."""
import sys
from drive import list_images

FOLDER = "https://drive.google.com/drive/folders/1AxvL7gY_hqY8SeswBxBzGGs3VqKlgncH?usp=drive_link"

print(f"Listing images in: {FOLDER}")
print("(First run will pop a browser for Google sign-in)")
print()

imgs = list_images(FOLDER)
print(f"Found {len(imgs)} image(s)")
for i, img in enumerate(imgs[:20]):
    print(f"  {i+1:>3}. {img.name}  [{img.mime_type}]")
if len(imgs) > 20:
    print(f"  ... and {len(imgs)-20} more")
