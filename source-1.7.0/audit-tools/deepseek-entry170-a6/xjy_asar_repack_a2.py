#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""xjy_asar_repack.py — 纯数据单成员 ASAR 重封（非安装程序）

只替换固定成员：
  renderer-dist/assets/main-7etXIfP0.js
固定输入 ASAR SHA256 = 20b597c6405ecb92592eb11a7db5ad8a3fe3a0a9d7ac83e430f25afd9040e375
固定替换字节 SHA256 = 870a724e04c030ec2bf3e3050b4adcf227c076cfc660a7e3d2421ba7b0db1ef7

不执行 APP/SQLite/EXE/CMD，不联网，不读私钥，不接触正式业务路径，不签名、不验签。
输出必须不存在（独占创建）；报告也必须不存在。
"""

import argparse
import hashlib
import json
import os
import struct
import sys
from datetime import datetime, timezone

EXPECTED_INPUT_SHA256 = "20b597c6405ecb92592eb11a7db5ad8a3fe3a0a9d7ac83e430f25afd9040e375"
EXPECTED_REPLACEMENT_SHA256 = "870a724e04c030ec2bf3e3050b4adcf227c076cfc660a7e3d2421ba7b0db1ef7"
TARGET_MEMBER = "renderer-dist/assets/main-7etXIfP0.js"
FILE_KEYS = frozenset(["size", "offset", "executable", "unpacked", "integrity"])
INTEGRITY_KEYS = frozenset(["algorithm", "hash", "blockSize", "blocks"])
MISSING = object()


class Blocked(Exception):
    def __init__(self, code, message):
        super().__init__(message)
        self.code = code
        self.message = message


def now_iso():
    return datetime.now(timezone.utc).isoformat()


def sha256_hex(data):
    return hashlib.sha256(data).hexdigest()


def sha256_file(path):
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        while True:
            block = handle.read(4 * 1024 * 1024)
            if not block:
                break
            digest.update(block)
    return digest.hexdigest()


def read_file(path, what):
    if not os.path.isfile(path):
        raise Blocked("MISSING_INPUT", "%s 不存在或不是普通文件：%s" % (what, path))
    with open(path, "rb") as handle:
        return handle.read()


def parse_uint(value, what):
    if isinstance(value, bool):
        raise Blocked("BAD_HEADER", "%s 不是整数：%r" % (what, value))
    if isinstance(value, int):
        if value < 0:
            raise Blocked("BAD_HEADER", "%s 不能为负：%d" % (what, value))
        return value
    if isinstance(value, str) and (value == "0" or (value and value[0] != "0" and value.isdigit())):
        return int(value)
    raise Blocked("BAD_HEADER", "%s 不是非负整数：%r" % (what, value))


def loads_strict(text, label):
    def hook(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise ValueError("重复键 %r" % key)
            result[key] = value
        return result

    try:
        return json.loads(text, object_pairs_hook=hook)
    except (ValueError, TypeError) as exc:
        raise Blocked("BAD_ASAR", "%s 头部 JSON 解析失败：%s" % (label, exc))


def parse_asar(buffer, label):
    total = len(buffer)
    if total < 32:
        raise Blocked("BAD_ASAR", "%s 过小，不是 ASAR：%d 字节" % (label, total))
    if struct.unpack_from("<I", buffer, 0)[0] != 4:
        raise Blocked("BAD_ASAR", "%s u32@0 不是 4" % label)
    header_size = struct.unpack_from("<I", buffer, 4)[0]
    if header_size < 16 or 8 + header_size > total:
        raise Blocked("BAD_ASAR", "%s headerSize 非法：%d" % (label, header_size))
    payload = struct.unpack_from("<I", buffer, 8)[0]
    if payload != header_size - 4:
        raise Blocked("BAD_ASAR", "%s 头部载荷与 headerSize-4 不一致" % label)
    json_len = struct.unpack_from("<I", buffer, 12)[0]
    padding = payload - 4 - json_len
    expected_padding = (4 - (json_len % 4)) % 4
    if padding != expected_padding:
        raise Blocked("BAD_ASAR", "%s JSON 填充 %d 与期望 %d 不一致" % (label, padding, expected_padding))
    json_start = 16
    json_end = json_start + json_len
    data_start = 8 + header_size
    if json_end + padding != data_start:
        raise Blocked("BAD_ASAR", "%s JSON 边界与数据区不一致" % label)
    header = loads_strict(buffer[json_start:json_end].decode("utf-8"), label)
    if not isinstance(header, dict) or list(header.keys()) != ["files"]:
        raise Blocked("BAD_ASAR", "%s 头部根字段应仅 files" % label)
    files = header["files"]
    if not isinstance(files, dict) or not files:
        raise Blocked("BAD_ASAR", "%s 头部 files 不是非空对象" % label)
    members = []

    def walk(node, prefix):
        for name, child in node.items():
            if not isinstance(name, str) or not name or "/" in name or "\\" in name:
                raise Blocked("BAD_ASAR", "%s 条目名不合法：%r" % (label, name))
            current = prefix + "/" + name if prefix else name
            if not isinstance(child, dict):
                raise Blocked("BAD_ASAR", "%s 条目不是对象：%s" % (label, current))
            if "files" in child:
                if len(child) != 1:
                    raise Blocked("BAD_ASAR", "%s 目录条目混入其他字段：%s" % (label, current))
                walk(child["files"], current)
                continue
            if "link" in child:
                if len(child) != 1 or not isinstance(child["link"], str):
                    raise Blocked("BAD_ASAR", "%s 链接条目格式不符：%s" % (label, current))
                members.append({"path": current, "kind": "link"})
                continue
            extra = set(child.keys()) - FILE_KEYS
            if extra:
                raise Blocked("BAD_ASAR", "%s 文件条目含未登记字段 %s：%s" % (label, sorted(extra), current))
            size = parse_uint(child.get("size"), "%s %s size" % (label, current))
            unpacked = child.get("unpacked") is True
            if "unpacked" in child and not isinstance(child["unpacked"], bool):
                raise Blocked("BAD_ASAR", "%s unpacked 不是布尔：%s" % (label, current))
            if "executable" in child and not isinstance(child["executable"], bool):
                raise Blocked("BAD_ASAR", "%s executable 不是布尔：%s" % (label, current))
            integrity = child.get("integrity")
            if integrity is not None:
                if not isinstance(integrity, dict):
                    raise Blocked("BAD_ASAR", "%s integrity 不是对象：%s" % (label, current))
                extra = set(integrity.keys()) - INTEGRITY_KEYS
                if extra:
                    raise Blocked("BAD_ASAR", "%s integrity 含未登记字段 %s：%s" % (label, sorted(extra), current))
            if "offset" in child:
                offset = parse_uint(child["offset"], "%s %s offset" % (label, current))
            elif unpacked:
                offset = None
            else:
                raise Blocked("BAD_ASAR", "%s 缺少 offset：%s" % (label, current))
            members.append({
                "path": current, "kind": "file", "size": size, "offset": offset,
                "unpacked": unpacked, "integrity": integrity,
            })

    walk(files, "")
    return {
        "label": label, "buffer": buffer, "header": header, "files_root": files,
        "members": members, "header_size": header_size, "json_len": json_len,
        "json_padding": padding, "data_start": data_start,
        "data_size": total - data_start, "total": total,
    }


def entry_map(files_root):
    mapping = {}

    def walk(node, prefix):
        for name, child in node.items():
            current = prefix + "/" + name if prefix else name
            mapping[current] = child
            if isinstance(child, dict) and "files" in child:
                walk(child["files"], current)

    walk(files_root, "")
    return mapping


def layout_ranges(parsed):
    label = parsed["label"]
    data_size = parsed["data_size"]
    ranged = []
    for member in parsed["members"]:
        if member["kind"] != "file" or member["unpacked"]:
            continue
        offset = member["offset"]
        size = member["size"]
        if offset is None:
            raise Blocked("BAD_ASAR", "%s 缺少偏移：%s" % (label, member["path"]))
        if offset > data_size or offset + size > data_size:
            raise Blocked("BAD_ASAR", "%s 超出数据区：%s" % (label, member["path"]))
        ranged.append(member)
    ordered = sorted(ranged, key=lambda m: (m["offset"], m["size"], m["path"]))
    max_member = None
    max_end = -1
    for member in ordered:
        if member["size"] <= 0:
            continue
        start = member["offset"]
        end = start + member["size"]
        if max_member is not None and start < max_end:
            same = start == max_member["offset"] and member["size"] == max_member["size"]
            if not same:
                raise Blocked("BAD_ASAR", "%s 数据区部分重叠：%s 与 %s" % (label, member["path"], max_member["path"]))
        if end > max_end:
            max_end = end
            max_member = member
    return ordered


def verify_shared_regions(parsed, ordered):
    buffer = parsed["buffer"]
    data_start = parsed["data_start"]
    groups = {}
    for member in ordered:
        if member["size"] <= 0:
            continue
        groups.setdefault((member["offset"], member["size"]), []).append(member)
    for (offset, size), members in groups.items():
        if len(members) < 2:
            continue
        first = buffer[data_start + offset:data_start + offset + size]
        for member in members[1:]:
            other = buffer[data_start + member["offset"]:data_start + member["offset"] + member["size"]]
            if other != first:
                raise Blocked("BAD_ASAR", "同区域条目内容不一致：%s 与 %s" % (members[0]["path"], member["path"]))


def find_target(parsed):
    matches = [m for m in parsed["members"] if m["path"] == TARGET_MEMBER]
    if not matches:
        raise Blocked("TARGET_MISSING", "目标成员不存在：%s" % TARGET_MEMBER)
    if len(matches) > 1:
        raise Blocked("TARGET_DUPLICATE", "目标成员重复：%s" % TARGET_MEMBER)
    target = matches[0]
    if target["kind"] != "file":
        raise Blocked("TARGET_KIND", "目标成员不是文件：%s" % TARGET_MEMBER)
    if target["unpacked"]:
        raise Blocked("TARGET_UNPACKED", "目标成员为 unpacked，没有可替换数据段")
    if target["offset"] is None:
        raise Blocked("TARGET_OFFSET", "目标成员缺少 offset")
    return target


def check_target_isolation(ordered, target):
    offset = target["offset"]
    size = target["size"]
    if size == 0:
        for member in ordered:
            if member is target:
                continue
            if member["size"] > 0 and member["offset"] < offset < member["offset"] + member["size"]:
                raise Blocked("TARGET_CROSSING", "其他成员跨越零长度目标位置：%s" % member["path"])
        return
    for member in ordered:
        if member is target:
            continue
        start = member["offset"]
        if start < offset + size and start + member["size"] > offset:
            if start == offset and member["size"] == size:
                raise Blocked("TARGET_SHARED", "其他成员共享目标数据段：%s" % member["path"])
            raise Blocked("TARGET_CROSSING", "其他成员与目标数据段交叉：%s" % member["path"])


def validate_integrity(integrity, data, label):
    algorithm = integrity.get("algorithm")
    if not isinstance(algorithm, str) or algorithm.upper() != "SHA256":
        raise Blocked("BAD_INTEGRITY", "%s integrity algorithm 不是 SHA256：%r" % (label, algorithm))
    if not isinstance(integrity.get("hash"), str) or integrity["hash"] != sha256_hex(data):
        raise Blocked("BAD_INTEGRITY", "%s integrity hash 与现有字节不符" % label)
    block_size = parse_uint(integrity.get("blockSize"), "%s integrity blockSize" % label)
    if block_size <= 0:
        raise Blocked("BAD_INTEGRITY", "%s integrity blockSize 非正" % label)
    blocks = integrity.get("blocks")
    expected = [sha256_hex(data[i:i + block_size]) for i in range(0, len(data), block_size)]
    if not isinstance(blocks, list) or blocks != expected:
        raise Blocked("BAD_INTEGRITY", "%s integrity blocks 与现有字节不符" % label)
    return block_size


def serialize_header(header):
    payload = json.dumps(header, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    length = len(payload)
    padding = (4 - (length % 4)) % 4
    header_size = 8 + length + padding
    size_pickle = struct.pack("<II", 4, header_size)
    header_pickle = struct.pack("<II", header_size - 4, length) + payload + b"\x00" * padding
    if len(header_pickle) != header_size:
        raise Blocked("INTERNAL", "头部长度计算不一致")
    return size_pickle + header_pickle


def plan(parsed, target, replacement):
    buffer = parsed["buffer"]
    data_start = parsed["data_start"]
    offset = target["offset"]
    old_size = target["size"]
    old_data = buffer[data_start + offset:data_start + offset + old_size]
    if len(old_data) != old_size:
        raise Blocked("BAD_ASAR", "目标数据段读取不完整")
    block_size = None
    if target["integrity"] is not None:
        block_size = validate_integrity(target["integrity"], old_data, target["path"])
    delta = len(replacement) - old_size
    new_header = json.loads(json.dumps(parsed["header"]))
    expected_entries = entry_map(new_header["files"])
    target_entry = expected_entries[TARGET_MEMBER]
    raw_size = target_entry.get("size")
    if isinstance(raw_size, bool) or not isinstance(raw_size, (int, str)):
        raise Blocked("BAD_HEADER", "目标 size 类型异常")
    target_entry["size"] = str(len(replacement)) if isinstance(raw_size, str) else len(replacement)
    if target["integrity"] is not None:
        updated = {}
        for key in target["integrity"].keys():
            if key == "hash":
                updated[key] = sha256_hex(replacement)
            elif key == "blocks":
                updated[key] = [sha256_hex(replacement[i:i + block_size]) for i in range(0, len(replacement), block_size)]
            else:
                updated[key] = target["integrity"][key]
        target_entry["integrity"] = updated
    shifted = []
    for member in parsed["members"]:
        if member["kind"] != "file" or member["unpacked"]:
            continue
        if member["path"] == TARGET_MEMBER:
            continue
        if member["offset"] >= offset + old_size:
            entry = expected_entries[member["path"]]
            raw_offset = entry.get("offset")
            new_offset = member["offset"] + delta
            entry["offset"] = str(new_offset) if isinstance(raw_offset, str) else new_offset
            shifted.append({"path": member["path"], "oldOffset": member["offset"], "newOffset": new_offset})
    header_bytes = serialize_header(new_header)
    payload = (header_bytes + buffer[data_start:data_start + offset]
               + replacement + buffer[data_start + offset + old_size:])
    return {
        "payload": payload, "delta": delta, "shifted": shifted,
        "expected_entries": expected_entries, "header_bytes": header_bytes,
        "header_size": len(header_bytes) - 8, "old_data": old_data, "block_size": block_size,
    }


def read_range(parsed, member):
    start = parsed["data_start"] + member["offset"]
    return parsed["buffer"][start:start + member["size"]]


def metadata_diff(original_entries, output_entries):
    diffs = {}
    for path in sorted(set(original_entries) | set(output_entries)):
        old = original_entries.get(path, MISSING)
        new = output_entries.get(path, MISSING)
        if old is MISSING or new is MISSING:
            diffs[path] = ["presence"]
            continue
        old_is_dir = isinstance(old, dict) and "files" in old
        new_is_dir = isinstance(new, dict) and "files" in new
        if old_is_dir or new_is_dir:
            if old_is_dir != new_is_dir:
                diffs[path] = ["kind"]
                continue
            # 目录条目只比较自身属性；后代子树由各自条目独立比较，不在此深比 files。
            old_own = dict((k, v) for k, v in old.items() if k != "files")
            new_own = dict((k, v) for k, v in new.items() if k != "files")
            changes = []
            for key in sorted(set(old_own) | set(new_own)):
                if old_own.get(key, MISSING) != new_own.get(key, MISSING):
                    changes.append("self." + key)
            if changes:
                diffs[path] = changes
            continue
        if not isinstance(old, dict) or not isinstance(new, dict):
            continue
        changes = []
        for key in sorted(set(old) | set(new)):
            old_value = old.get(key, MISSING)
            new_value = new.get(key, MISSING)
            if old_value is MISSING or new_value is MISSING:
                changes.append(key)
            elif key == "integrity" and isinstance(old_value, dict) and isinstance(new_value, dict):
                for sub in sorted(set(old_value) | set(new_value)):
                    if old_value.get(sub, MISSING) != new_value.get(sub, MISSING):
                        changes.append("integrity." + sub)
            elif old_value != new_value:
                changes.append(key)
        if changes:
            diffs[path] = changes
    return diffs


def verify_output(output_path, parsed, replacement, planned, target):
    raw = read_file(output_path, "输出 ASAR")
    out = parse_asar(raw, "输出")
    ordered = layout_ranges(out)
    verify_shared_regions(out, ordered)
    out_target = find_target(out)
    check_target_isolation(ordered, out_target)
    if out["header_size"] != planned["header_size"]:
        raise Blocked("VERIFY_HEADER", "输出 headerSize 与预期不符")
    original_members = {m["path"]: m for m in parsed["members"]}
    output_members = {m["path"]: m for m in out["members"]}
    if set(original_members) != set(output_members):
        raise Blocked("VERIFY_MEMBERS", "成员集合与原包不一致")
    content_changed = []
    for path in sorted(original_members):
        old = original_members[path]
        new = output_members[path]
        if old["kind"] != new["kind"]:
            raise Blocked("VERIFY_MEMBERS", "成员类型变化：%s" % path)
        if old["kind"] != "file":
            continue
        if old["unpacked"] or new["unpacked"]:
            if old["unpacked"] != new["unpacked"]:
                raise Blocked("VERIFY_MEMBERS", "unpacked 变化：%s" % path)
            continue
        old_bytes = read_range(parsed, old)
        new_bytes = read_range(out, new)
        if path == TARGET_MEMBER:
            if new["size"] != len(replacement) or new_bytes != replacement:
                raise Blocked("VERIFY_TARGET", "目标内容或大小不符")
            content_changed.append(path)
        else:
            if new["size"] != old["size"] or sha256_hex(new_bytes) != sha256_hex(old_bytes):
                raise Blocked("VERIFY_CONTENT", "非目标成员内容变化：%s" % path)
    if content_changed != [TARGET_MEMBER]:
        raise Blocked("VERIFY_CONTENT", "变化成员不止目标：%r" % content_changed)
    original_entries = entry_map(parsed["files_root"])
    output_entries = entry_map(out["files_root"])
    for path, expected in planned["expected_entries"].items():
        actual = output_entries.get(path, MISSING)
        if actual is MISSING or actual != expected:
            raise Blocked("VERIFY_METADATA", "输出条目与预期不符：%s" % path)
    diffs = metadata_diff(original_entries, output_entries)
    shifted_paths = set(item["path"] for item in planned["shifted"])
    unexpected = set(diffs) - ({TARGET_MEMBER} | shifted_paths)
    if unexpected:
        raise Blocked("VERIFY_METADATA", "未预期元数据变化：%s" % sorted(unexpected))
    allowed_target = {"size", "integrity.hash", "integrity.blocks"}
    target_changes = set(diffs.get(TARGET_MEMBER, []))
    if not target_changes <= allowed_target:
        raise Blocked("VERIFY_METADATA", "目标元数据变化超出允许：%s" % sorted(target_changes))
    for item in planned["shifted"]:
        changes = set(diffs.get(item["path"], []))
        if item["oldOffset"] == item["newOffset"]:
            if changes:
                raise Blocked("VERIFY_METADATA", "非平移成员出现变化：%s %s" % (item["path"], sorted(changes)))
        elif changes != {"offset"}:
            raise Blocked("VERIFY_METADATA", "平移成员变化不符：%s %s" % (item["path"], sorted(changes)))
    return out, content_changed, diffs


def base_report(args):
    return {
        "tool": "xjy_asar_repack",
        "status": None,
        "generatedAt": now_iso(),
        "unsigned": True,
        "signatureNote": "本工具不签名、不验签；改动后原发布签名必然失效，发布前必须由发布链重新签名与验签",
        "targetMember": TARGET_MEMBER,
        "inputs": {},
        "output": {},
        "changedMembers": [],
        "shiftedMembers": [],
        "metadataChanges": [],
        "verification": {},
        "checks": {},
    }


def run(args, report):
    input_path = os.path.abspath(args.input_asar)
    replacement_path = os.path.abspath(args.replacement_js)
    output_path = os.path.abspath(args.out_new_create)
    report_path = os.path.abspath(args.report)
    if output_path == input_path:
        raise Blocked("OUTPUT_ALIAS", "输出不能与输入同一路径")
    if report_path in (input_path, replacement_path, output_path):
        raise Blocked("REPORT_ALIAS", "报告路径不能与其他参数相同")
    if os.path.exists(output_path):
        raise Blocked("OUTPUT_EXISTS", "输出已存在，拒绝覆盖：%s" % output_path)
    if os.path.exists(report_path):
        raise Blocked("REPORT_EXISTS", "报告文件已存在，拒绝覆盖：%s" % report_path)

    input_bytes = read_file(input_path, "输入 ASAR")
    input_sha = sha256_hex(input_bytes)
    if input_sha != EXPECTED_INPUT_SHA256:
        raise Blocked("INPUT_SHA", "输入 ASAR 摘要不符：%s" % input_sha)
    replacement = read_file(replacement_path, "替换 JS")
    replacement_sha = sha256_hex(replacement)
    if replacement_sha != EXPECTED_REPLACEMENT_SHA256:
        raise Blocked("REPLACEMENT_SHA", "替换字节摘要不符：%s" % replacement_sha)
    if not replacement:
        raise Blocked("REPLACEMENT_EMPTY", "替换字节为空")

    report["inputs"] = {
        "asar": input_path, "asarSha256": input_sha, "asarSize": len(input_bytes),
        "replacement": replacement_path, "replacementSha256": replacement_sha,
        "replacementSize": len(replacement),
    }
    parsed = parse_asar(input_bytes, "输入")
    ordered = layout_ranges(parsed)
    verify_shared_regions(parsed, ordered)
    target = find_target(parsed)
    check_target_isolation(ordered, target)
    planned = plan(parsed, target, replacement)

    with open(output_path, "xb") as handle:
        handle.write(planned["payload"])
        handle.flush()
        os.fsync(handle.fileno())
    if os.path.getsize(output_path) != len(planned["payload"]):
        raise Blocked("VERIFY_SIZE", "输出文件大小与生成字节不一致")

    out, content_changed, diffs = verify_output(output_path, parsed, replacement, planned, target)
    input_unchanged = sha256_file(input_path) == EXPECTED_INPUT_SHA256
    if not input_unchanged:
        raise Blocked("INPUT_CHANGED", "运行后输入 ASAR 摘要发生变化")

    metadata_changes = []
    for path in sorted(diffs):
        metadata_changes.append({"path": path, "fields": diffs[path]})
    report["status"] = "Succeeded"
    report["output"] = {
        "path": output_path,
        "sha256": sha256_file(output_path),
        "size": os.path.getsize(output_path),
        "headerSize": out["header_size"],
        "jsonLength": out["json_len"],
        "dataStart": out["data_start"],
    }
    report["delta"] = planned["delta"]
    report["changedMembers"] = content_changed
    report["shiftedMembers"] = planned["shifted"]
    report["metadataChanges"] = metadata_changes
    report["verification"] = {
        "membersCompared": len(out["members"]),
        "contentChanged": content_changed,
        "inputUnchangedAfterRun": input_unchanged,
        "outputReparsed": True,
    }
    report["checks"] = {
        "inputShaMatches": True,
        "replacementShaMatches": True,
        "targetFoundOnce": True,
        "targetNotUnpacked": True,
        "noTargetOverlapOrShare": True,
        "noForcedAlignment": True,
        "outputExclusiveCreate": True,
        "headerRecomputed": True,
        "otherMembersByteIdentical": True,
        "metadataOnlyAllowed": True,
    }


def emit_report(path, report):
    text = json.dumps(report, ensure_ascii=False, indent=2)
    with open(path, "x", encoding="utf-8", newline="\n") as handle:
        handle.write(text + "\n")
    return text


def main(argv=None):
    parser = argparse.ArgumentParser(
        description="纯数据单成员 ASAR 重封（非安装程序；只替换一个固定成员数据段）")
    parser.add_argument("--input-asar", required=True)
    parser.add_argument("--replacement-js", required=True)
    parser.add_argument("--out-new-create", required=True)
    parser.add_argument("--report", required=True)
    args = parser.parse_args(argv)
    report = base_report(args)
    try:
        run(args, report)
    except Blocked as exc:
        report["status"] = "Blocked"
        report["blocked"] = {"code": exc.code, "message": exc.message}
        try:
            emit_report(args.report, report)
        except (Blocked, OSError) as second:
            print("[WARN] 报告未写入：%s" % second, file=sys.stderr)
        print("[BLOCKED] %s %s" % (exc.code, exc.message))
        return 2
    except Exception as exc:  # noqa: BLE001 - 纯数据工具，异常一律失败关闭
        report["status"] = "Failed"
        report["error"] = "%s: %s" % (type(exc).__name__, exc)
        try:
            emit_report(args.report, report)
        except (Blocked, OSError):
            pass
        print("[FAILED] %s" % report["error"], file=sys.stderr)
        return 1
    try:
        emit_report(args.report, report)
    except (Blocked, OSError) as exc:
        print("[BLOCKED] 报告未写入：%s" % exc)
        return 2
    print("[OK] 输出 SHA256=%s" % report["output"]["sha256"])
    print("[OK] 变化成员=%s" % ",".join(report["changedMembers"]))
    print("[OK] 平移成员=%d 偏移差=%d" % (len(report["shiftedMembers"]), report["delta"]))
    print("[OK] 报告=%s" % os.path.abspath(args.report))
    return 0


if __name__ == "__main__":
    sys.exit(main())