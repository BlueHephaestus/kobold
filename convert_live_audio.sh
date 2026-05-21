#!/bin/bash
set -x
echo $1
echo $2
ffmpeg -ss 3060 -i "$1" -acodec pcm_s16le -ac 1 -ar 16000 "$2"

