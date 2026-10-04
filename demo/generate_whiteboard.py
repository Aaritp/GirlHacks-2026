"""Generate the fictional OCR rehearsal board; no AI or real customer information."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont


def main():
    image = Image.new("RGB", (1400, 850), "white")
    draw = ImageDraw.Draw(image)
    font = ImageFont.load_default(size=40)
    lines = [
        "CUSTOMER ONBOARDING - FICTIONAL DEMO",
        "",
        "Alex will send the payroll integration checklist.",
        "Deadline: October 5, 2026.",
        "",
        "Sam will schedule the onboarding review",
        "after the checklist is ready.",
        "",
        "Decision: use Quetzal-X9 for the pilot.",
    ]
    for index, line in enumerate(lines):
        draw.text((55, 50 + index * 80), line, font=font, fill="#183327")
    path = Path(__file__).with_name("whiteboard.png")
    image.save(path)
    print(path)


if __name__ == "__main__":
    main()
