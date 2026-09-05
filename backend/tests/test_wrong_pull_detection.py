"""A wrong pull must not be silent.

The album that started this was visibly, obviously wrong on the page and
invisible to every check the app ran. The integrity loop knew about missing
files, silent videos and pictures on expiring URLs; nothing knew the two
signatures of a pull that came back with the wrong thing.

`resolve_tier` made it worse by being *almost* useful: it recorded the
degradation from 3.18.0 onward and no surface ever read it.
"""
import inspect


# ------------------------------------------------ the two new signatures


def test_the_scan_counts_pictureless_videos():
    """A memo filed as video whose file holds no pictures. One cause, no
    innocent reading, so the UI may say "re-pull these" without nagging."""
    from backend.core import integrity

    src = inspect.getsource(integrity._scan_sync)
    assert "_has_video_stream(resolved) is False" in src
    assert "pictureless_videos += 1" in src


def test_a_music_memo_is_never_counted_as_a_broken_video():
    """An audio memo's file has no pictures BY DESIGN. Counting those would
    report the entire music library as broken, which is the one outcome that
    would make this check worse than nothing."""
    from backend.core import integrity

    src = inspect.getsource(integrity._scan_sync)
    # The picture test lives inside the `type == video` branch, under the same
    # guard the audio test already uses.
    assert 'elif (memo_type or "").lower() == "video":' in src
    assert src.index('elif (memo_type or "").lower() == "video":') < src.index(
        "pictureless_videos += 1"
    )


def test_ffprobe_being_unavailable_reports_nothing():
    """`is False` only. None means it could not tell, and a box without ffprobe
    must not have its whole library reported as broken."""
    from backend.core import integrity

    src = inspect.getsource(integrity._scan_sync)
    assert "_has_video_stream(resolved) is False" in src
    assert "_has_video_stream(resolved) is None" not in src


def test_the_scan_counts_degraded_reads():
    from backend.core import integrity

    src = inspect.getsource(integrity._scan_sync)
    assert 'if (resolve_tier or "") == "scope:page":' in src
    assert "degraded_reads += 1" in src


def test_a_repairable_pull_is_not_a_data_loss_incident():
    """`_verdict` escalates when FILES go missing. A wrong pull loses nothing
    and is fixed by re-pulling, so folding it in would cry wolf and blunt the
    one alarm that means "stop writing to this disk"."""
    from backend.core import integrity

    src = inspect.getsource(integrity._verdict)
    assert "pictureless" not in src
    assert "degraded" not in src


# ------------------------------------------------------- reaching the user


def test_the_counts_reach_the_api():
    from backend.core import integrity

    src = inspect.getsource(integrity._scan_sync)
    for key in ('"pictureless_videos"', '"degraded_reads"',
                '"pictureless_memo_ids"', '"degraded_memo_ids"'):
        assert key in src


# --------------------------------------------------------- the repair path


def test_the_repair_endpoint_exists_and_is_dry_run_by_default():
    """It queues real work against real hosts. The honest default for something
    that heavy is to show what it would touch first."""
    from backend.api import maintenance

    src = inspect.getsource(maintenance.repull_wrong_pulls)
    assert "dry_run: bool = True" in src


def test_the_bulk_degraded_sweep_is_opt_in():
    """Hundreds of browser renders must never fire from a default."""
    from backend.api import maintenance

    src = inspect.getsource(maintenance.repull_wrong_pulls)
    assert "degraded: bool = False" in src
    assert "pictureless: bool = True" in src


def test_an_upload_is_never_queued_for_a_repull():
    """No source URL means nothing to fetch again."""
    from backend.api import maintenance

    src = inspect.getsource(maintenance.repull_wrong_pulls)
    assert 'if not (source_url or "").strip():' in src


# ------------------------------------------------------- the automatic fix


def test_a_degraded_save_re_reads_itself_once():
    """The one piece that fixes this without anyone noticing. render_page
    clicks decline on a consent gate and then persists the jar, so attempt two
    starts past the gate that beat attempt one."""
    from backend.api import ingest

    src = inspect.getsource(ingest.ingest_url_core)
    assert '(memo.resolve_tier or "") == SCOPE_TIER_PAGE' in src
    assert "schedule(reresolve_memo_task, memo.id)" in src


def test_the_retry_never_downloads():
    """Review caught this. Re-pulling would run a SECOND download of a memo the
    save path is already downloading, override the embed-host rule that decided
    not to fetch it, and on an audio memo replace the song with an mp4."""
    from backend.api.ingest import reresolve_memo_task, repull_memo_task

    assert "resolve_only=True" in inspect.getsource(reresolve_memo_task)
    src = inspect.getsource(repull_memo_task)
    assert "if resolve_only:" in src
    # and the early return must come BEFORE the download step
    assert src.index("if resolve_only:") < src.index("# 2. The download.")


def test_the_retry_is_routed_with_only_a_memo_id():
    """A queue entry that carries a `mode` can be replayed as a download. This
    one persists the id alone, so it cannot become something else."""
    from backend.core.job_handlers import _ROUTING, _p_memo

    assert _ROUTING["reresolve_memo_task"][1] is _p_memo


def test_the_music_page_never_triggers_a_video_retry():
    """Music "+" means "give me the SONG of this link". A TikTok or Facebook
    link pasted there can degrade, and retrying it as a video races the audio
    download for the same memo."""
    from backend.api import ingest

    assert "not data.audio_only" in inspect.getsource(ingest.ingest_url_core)


def test_a_relay_batch_does_not_queue_a_render_per_link():
    """The relay calls ingest_url_core once per forwarded URL. Thirty forwarded
    links would queue thirty headless renders nobody asked for, which is the
    fan-out the never-default-on rule exists to stop."""
    from backend.api import ingest

    assert "not data.force_localize" in inspect.getsource(ingest.ingest_url_core)


def test_dont_pull_still_means_dont_pull():
    from backend.api import ingest

    assert "not data.no_pull" in inspect.getsource(ingest.ingest_url_core)


# ------------------------------------------- the sweep must never eat music


def _sweep_source():
    from backend.api import maintenance

    return inspect.getsource(maintenance.repull_wrong_pulls)


def test_the_sweep_skips_every_audio_memo():
    """THE critical finding of the review. `resolve_tier` is written by the
    ORIGINAL save and survives a later conversion to audio, so a TikTok link the
    user turned into a song still carries `scope:page`. Sweeping that as a video
    replaces the song with an mp4, or detaches the file outright when the post
    resolves to pictures."""
    src = _sweep_source()
    assert 'if kind == "audio" or audio_kind:' in src
    assert "continue" in src.split('if kind == "audio" or audio_kind:')[1][:40]


def test_the_sweep_reads_audio_kind_not_just_type():
    """Belt and braces: a music memo re-typed by the startup sorter (the
    extension is `derive_memo_type`'s first signal) still carries audio_kind."""
    src = _sweep_source()
    assert "Memo.audio_kind" in src


def test_the_sweep_derives_mode_instead_of_hardcoding_video():
    """`memos.py` already established this convention and the first cut ignored
    it, hardcoding "video" at both new call sites."""
    src = _sweep_source()
    assert 'if t["type"] == "audio" else "video"' in src


def test_ffprobe_runs_off_the_event_loop():
    """A process spawn per candidate, inside an async route, freezes every
    other request for the length of the scan. Measured at 8.4s in review."""
    assert "await asyncio.to_thread(_pick, rows)" in _sweep_source()


def test_the_certain_repairs_are_never_crowded_out_of_the_limit():
    """Slicing an arbitrary DB order let an opt-in `degraded` sweep starve the
    pictureless memos the endpoint exists for."""
    src = _sweep_source()
    assert 'targets.sort(key=lambda t: 0 if t["reason"] == "pictureless" else 1)' in src
    assert src.index("targets.sort(") < src.index("targets[:limit]")


def test_the_limit_is_validated():
    src = _sweep_source()
    assert "Query(50, ge=1, le=500)" in src


def test_the_sweep_and_the_scan_agree_about_deleted_memos():
    """The scan counts `is_deleted is null`; an endpoint that filtered only on
    `is False` could never repair a row the scan reported."""
    assert "Memo.is_deleted.is_(None)" in _sweep_source()


# ------------------------------------------------------- reachable by a user


def test_the_repair_has_an_api_client():
    """An endpoint reachable only by curl is not a fix for someone who does not
    have a terminal, which was the entire point of the request."""
    from pathlib import Path

    api = Path("frontend/src/lib/api.ts").read_text(encoding="utf-8")
    assert "repullWrongPulls" in api
    assert "repull-wrong-pulls" in api


def test_the_panel_has_a_button_and_asks_before_it_fetches():
    from pathlib import Path

    page = Path("frontend/src/pages/SettingsPage.tsx").read_text(encoding="utf-8")
    assert "repullWrongPulls" in page
    # dry run first, commit on a second deliberate click
    assert "dryRun: true" in page and "dryRun: false" in page


def test_the_panel_never_says_zero_files_are_missing():
    """With nothing missing and one wrong pull, the headline used to read
    "0 files referenced by your library are missing from disk" above correct
    copy about wrong pulls, contradicting the row directly above it."""
    from pathlib import Path

    page = Path("frontend/src/pages/SettingsPage.tsx").read_text(encoding="utf-8")
    assert "missing > 0" in page
    assert "did not come back from" in page
