# AssemblyAI configuration
MAX_SPEAKERS = 5
DM_DESCRIPTION = "Host of the game being played, organizer of events who manages player interaction and queries players for their next action. Describes scenes and leads conversations, as well as acting out various side characters."
PLAYER_DESCRIPTION = "Player of the game being played, participates and role-plays as a singular character in the adventure being described, dictating what actions their character would take and asking questions about the world being described."

CONNECTION_PARAMS = {
    "sample_rate": 16000,
    "speech_model": "u3-rt-pro",
    "speaker_labels": True,
    "max_speakers": 5
}
# "speech_understanding": {
#     "request": {
#         "speaker_identification": {
#             "speaker_type": "role",
#             "speakers": [
#                 {
#                     "role": "DM",
#                     "description": DM_DESCRIPTION,
#                 },
#             ]
#         }
#     }
# },
# # Add players to the speaker identification config
# for speaker_i in range(1, MAX_SPEAKERS + 1):
#     # Give alphabetical index instead of numerical
#     speaker = chr(64 + speaker_i)  # 1 -> A, 2 -> B, etc.
#     CONNECTION_PARAMS["speech_understanding"]["request"]["speaker_identification"]["speakers"].append({
#         "role": f"Player {speaker}",
#         "description": PLAYER_DESCRIPTION.format(speaker=speaker)
#     })
# Summarization Configuration
SUMMARIZE_INTERVAL = 300
SUMMARIZE_RECENT_SUMMARIES = 5
