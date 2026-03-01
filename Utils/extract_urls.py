# import os
# import re
# from yt_dlp import YoutubeDL


# def clean_filename(name):
#     """Make filename safe for filesystem."""
#     return re.sub(r'[\\/*?:"<>|]', "", name)


# def extract_playlist_subs(playlist_url, output_dir, lang="en"):
#     os.makedirs(output_dir, exist_ok=True)

#     # First: get flat playlist (fast)
#     ydl_opts_flat = {
#         "quiet": True,
#         "extract_flat": True,
#         "skip_download": True,
#     }

#     with YoutubeDL(ydl_opts_flat) as ydl:
#         playlist = ydl.extract_info(playlist_url, download=False)

#     entries = playlist.get("entries", [])

#     print(f"Found {len(entries)} videos in playlist.\n")

#     # Now process each video individually
#     for entry in entries:
#         if not entry:
#             continue

#         video_id = entry.get("id")
#         video_url = f"https://www.youtube.com/watch?v={video_id}"

#         print(f"Processing: {video_url}")

#         ydl_opts = {
#             "quiet": True,
#             "skip_download": True,
#         }

#         with YoutubeDL(ydl_opts) as ydl:
#             try:
#                 info = ydl.extract_info(video_url, download=False)
#             except Exception as e:
#                 print(f"skipped video")
#                 continue

#         title = clean_filename(info.get("title", video_id))
#         auto_captions = info.get("automatic_captions", {})

#         if lang not in auto_captions:
#             print(f"  ❌ No auto captions in '{lang}'\n")
#             continue

#         # Prefer VTT format
#         caption_formats = auto_captions[lang]
#         caption_url = None

#         for fmt in caption_formats:
#             if fmt.get("ext") == "vtt":
#                 caption_url = fmt.get("url")
#                 break

#         if not caption_url:
#             caption_url = caption_formats[0].get("url")

#         # Download caption file
#         with YoutubeDL({"quiet": True}) as ydl:
#             caption_data = ydl.urlopen(caption_url).read().decode("utf-8")

#         # Convert VTT to plain text
#         lines = []
#         for line in caption_data.splitlines():
#             line = line.strip()
#             if not line:
#                 continue
#             if line.startswith("WEBVTT") or "-->" in line:
#                 continue
#             if line.isdigit():
#                 continue
#             lines.append(line)

#         clean_text = "\n".join(lines)

#         # Save to file
#         file_path = os.path.join(output_dir, f"{title}.txt")

#         with open(file_path, "w", encoding="utf-8") as f:
#             f.write(clean_text)

#         print(f"  ✅ Saved: {file_path}\n")

#     print("Done.")


# if __name__ == "__main__":
#     playlist_url = "https://www.youtube.com/playlist?list=PLtcKoMKympIMtPIsqVFRTN1XHxgp7VixW"
#     output_directory = "./video_subs"

#     extract_playlist_subs(playlist_url, output_directory, lang="en")

import os

def merge_subtitles(input_dir, output_file):
    # Get all .txt files
    files = [f for f in os.listdir(input_dir) if f.endswith(".txt")]

    # Sort files alphabetically (optional but recommended)
    files.sort()

    with open(output_file, "w", encoding="utf-8") as outfile:
        for filename in files:
            file_path = os.path.join(input_dir, filename)

            try:
                with open(file_path, "r", encoding="utf-8") as infile:
                    content = infile.read().strip()

                # Write separator header (video title)
                outfile.write("=" * 80 + "\n")
                outfile.write(f"TITLE: {filename}\n")
                outfile.write("=" * 80 + "\n\n")

                outfile.write(content + "\n\n")

                print(f"Added: {filename}")

            except Exception as e:
                print(f"Skipped {filename} due to error: {e}")

    print("\nAll subtitles merged successfully.")


if __name__ == "__main__":
    input_directory = "./video_subs"   # Folder containing subtitle .txt files
    output_filename = "merged_subtitles.txt"

    merge_subtitles(input_directory, output_filename)
