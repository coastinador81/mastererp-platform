"""Content-free Live event timing for diagnosing delayed transcripts."""
from time import monotonic


class LiveSignalTiming:
    def __init__(self):
        self.current = None
        self.samples = []
        self.vad_ends = 0

    def start(self):
        self._finish()
        self.current = {'end': None, 'input': None, 'audio': None,
                        'complete': None}

    def mark(self, kind):
        if self.current is None:
            self.start()
        if kind not in self.current:
            raise ValueError('invalid Live timing signal')
        if self.current[kind] is None:
            self.current[kind] = monotonic()
            if kind == 'end':
                self.vad_ends += 1

    def _finish(self):
        if self.current is None:
            return
        end = self.current['end']
        if end is not None and len(self.samples) < 8:
            # Signed input offset distinguishes text already available at
            # silence from text delivered after the assistant has replied.
            self.samples.append(tuple(
                round((self.current[key] - end) * 1000)
                if self.current[key] is not None else None
                for key in ('input', 'audio', 'complete')))
        self.current = None

    def summary(self):
        self._finish()
        samples = ';'.join(','.join('n' if value is None else str(value)
                               for value in sample) for sample in self.samples)
        return self.vad_ends, samples or 'none'
