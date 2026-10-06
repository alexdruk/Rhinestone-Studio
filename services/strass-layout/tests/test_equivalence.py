"""S5.1: the package and the prototype scripts give identical stone lists on this machine."""
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest

from tests import support

SWITCHES = ("TARGET_PITCH", "CATALOGUE", "KL", "VIVID", "CHROMA_W", "SKIN_NATURAL", "CLOSE_PX", "SD_VIEWS", "SD_IN",
            "SD_OUT", "FUSED_OUT", "EYE_MODE", "LASHES", "CL_INSIDE", "STRASS_W", "STRASS_MODELS")


def run_prototype(name):
    """Run prototype/run_one.sh in a temporary copy of prototype/ and return its final stone list."""
    work = tempfile.mkdtemp(prefix="strass-proto-")
    try:
        shutil.copytree(support.PROTOTYPE_DIR, work, dirs_exist_ok=True,
                        ignore=shutil.ignore_patterns("N2_*", "expected", "__pycache__"))
        os.makedirs(os.path.join(work, "img"), exist_ok=True)
        shutil.copy(os.path.join(support.IMG_DIR, "N2_%s.png" % name), os.path.join(work, "img"))
        env = {k: v for k, v in os.environ.items() if k not in SWITCHES}
        env["PATH"] = os.path.dirname(sys.executable) + os.pathsep + env.get("PATH", "")
        env["STRASS_W"] = work
        env["STRASS_MODELS"] = support.MODELS_DIR + os.sep
        proc = subprocess.run(["bash", os.path.join(work, "run_one.sh"), name], cwd=work, env=env,
                              capture_output=True, text=True)
        if proc.returncode != 0:
            raise RuntimeError("run_one.sh %s failed:\n%s\n%s" % (name, proc.stdout[-2000:], proc.stderr[-2000:]))
        with open(os.path.join(work, "N2_%s_final_rs.json" % name)) as f:
            return json.load(f)["stones"]
    finally:
        shutil.rmtree(work, ignore_errors=True)


def first_difference(ours, reference):
    for i, (a, b) in enumerate(zip(ours, reference)):
        if a != b:
            return i
    return min(len(ours), len(reference)) if len(ours) != len(reference) else None


class Equivalence(unittest.TestCase):
    def check_image(self, name):
        if os.environ.get("STRASS_SKIP_EQUIVALENCE") == "1":
            self.skipTest("STRASS_SKIP_EQUIVALENCE=1")
        reference = run_prototype(name)
        ours = support.frame_result(name)["stones"]
        i = first_difference(ours, reference)
        print("EQUIV %s package=%d prototype=%d identical=%s" % (name, len(ours), len(reference), i is None))
        if i is not None:
            self.fail("%s: first differing stone index %d; package has %d stones, prototype %d; package %r, prototype %r" % (
                name, i, len(ours), len(reference), ours[i] if i < len(ours) else None, reference[i] if i < len(reference) else None))


def _make(name):
    def test(self):
        self.check_image(name)
    return test


for _name in support.IMAGES:
    setattr(Equivalence, "test_" + _name, _make(_name))


if __name__ == "__main__":
    unittest.main()
