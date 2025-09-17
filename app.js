// ========== Константы ==========
const STORAGE_KEYS = {
    STATE: "quiz.state.v1",
};
const DATA_URL = "./data/questions.json";

// ========== Модели ==========
class Question {
    constructor(dto) {
        this.id = dto.id;
        this.text = dto.text;
        this.options = dto.options;
        this.correctIndex = dto.correctIndex;
        this.topic = dto.topic ?? null;
    }
}

class QuizEngine {
    constructor(quiz) {
        this.title = quiz.title;
        this.timeLimitSec = quiz.timeLimitSec;
        this.passThreshold = quiz.passThreshold;
        this.questions = quiz.questions.map((q) => new Question(q));

        this.currentIndex = 0;
        this.answers = {}; // questionId -> selectedIndex
        this.remainingSec = quiz.timeLimitSec;
        this.isFinished = false;
    }

    get length() {
        return this.questions.length;
    }

    get currentQuestion() {
        return this.questions[this.currentIndex];
    }

    goTo(index) {
        if (index < 0 || index >= this.length) return false;
        this.currentIndex = index;
        return true;
    }

    next() {
        if (this.currentIndex < this.length - 1) {
            this.currentIndex++;
            return true;
        }
        return false;
    }

    prev() {
        if (this.currentIndex > 0) {
            this.currentIndex--;
            return true;
        }
        return false;
    }

    select(optionIndex) {
        const q = this.currentQuestion;
        this.answers[q.id] = optionIndex;
    }

    getSelectedIndex() {
        const q = this.currentQuestion;
        return this.answers[q.id];
    }

    tick() {
        if (this.isFinished || this.remainingSec <= 0) return;
        this.remainingSec--;
        if (this.remainingSec <= 0) {
            this.finish();
        }
    }

    finish() {
        if (this.isFinished) return this.getSummary();
        this.isFinished = true;
        return this.getSummary();
    }

    getSummary() {
        let correct = 0;
        for (const q of this.questions) {
            if (this.answers[q.id] === q.correctIndex) {
                correct++;
            }
        }
        const total = this.questions.length;
        const percent = total > 0 ? correct / total : 0;
        const passed = percent >= this.passThreshold;
        return { correct, total, percent, passed };
    }

    toState() {
        return {
            currentIndex: this.currentIndex,
            answers: { ...this.answers },
            remainingSec: this.remainingSec,
            isFinished: this.isFinished,
        };
    }

    static fromState(quiz, state) {
        const engine = new QuizEngine(quiz);
        engine.currentIndex = state.currentIndex ?? 0;
        engine.answers = state.answers ?? {};
        engine.remainingSec = state.remainingSec ?? quiz.timeLimitSec;
        engine.isFinished = state.isFinished ?? false;
        return engine;
    }
}

// ========== Хранилище ==========
class StorageService {
    static saveState(state) {
        localStorage.setItem(STORAGE_KEYS.STATE, JSON.stringify(state));
    }

    static loadState() {
        const raw = localStorage.getItem(STORAGE_KEYS.STATE);
        return raw ? JSON.parse(raw) : null;
    }

    static clear() {
        localStorage.removeItem(STORAGE_KEYS.STATE);
    }
}

// ========== DOM ==========
const $ = (sel) => document.querySelector(sel);
const els = {
    title: $("#quiz-title"),
    progress: $("#progress"),
    timer: $("#timer"),
    qText: $("#question-text"),
    form: $("#options-form"),
    btnPrev: $("#btn-prev"),
    btnNext: $("#btn-next"),
    btnFinish: $("#btn-finish"),
    result: $("#result-section"),
    resultSummary: $("#result-summary"),
    btnReview: $("#btn-review"),
    btnRestart: $("#btn-restart"),
};

let engine = null;
let timerId = null;
let reviewMode = false;

// ========== Инициализация ==========
document.addEventListener("DOMContentLoaded", async () => {
    try {
        const quiz = await loadQuiz();
        els.title.textContent = quiz.title;

        const saved = StorageService.loadState();
        engine = saved ? QuizEngine.fromState(quiz, saved) : new QuizEngine(quiz);

        bindEvents();
        renderAll();
        startTimer();
    } catch (err) {
        els.title.textContent = "Ошибка загрузки";
        console.error(err);
    }
});

async function loadQuiz() {
    const res = await fetch(DATA_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!data?.questions?.length) throw new Error("Некорректные данные");
    return data;
}

// ========== Таймер ==========
function startTimer() {
    stopTimer();
    timerId = setInterval(() => {
        if (!engine) return;
        engine.tick();
        persist();
        renderTimer();
    }, 1000);
}

function stopTimer() {
    if (timerId) clearInterval(timerId);
    timerId = null;
}

// ========== События ==========
function bindEvents() {
    els.btnPrev.addEventListener("click", () => {
        if (engine?.prev()) {
            persist();
            renderAll();
        }
    });

    els.btnNext.addEventListener("click", () => {
        if (engine?.next()) {
            persist();
            renderAll();
        }
    });

    els.btnFinish.addEventListener("click", () => {
        if (!engine) return;
        const summary = engine.finish();
        stopTimer();
        renderResult(summary);
        persist();
    });

    els.btnReview.addEventListener("click", () => {
        reviewMode = true;
        renderAll();
    });

    els.btnRestart.addEventListener("click", () => {
        StorageService.clear();
        location.reload();
    });

    els.form.addEventListener("change", (e) => {
        const target = e.target;
        if (target?.name === "option") {
            const idx = Number(target.value);
            engine?.select(idx);
            persist();
            renderNav();
        }
    });
}

// ========== Рендер ==========
function renderAll() {
    if (!engine) return;
    renderProgress();
    renderTimer();
    renderQuestion();
    renderNav();
}

function renderProgress() {
    els.progress.textContent = `Вопрос ${engine.currentIndex + 1} из ${engine.length}`;
}

function renderTimer() {
    const sec = engine.remainingSec;
    const m = Math.floor(sec / 60).toString().padStart(2, "0");
    const s = (sec % 60).toString().padStart(2, "0");
    els.timer.textContent = `${m}:${s}`;
}

function renderQuestion() {
    const q = engine.currentQuestion;
    els.qText.textContent = q.text;

    els.form.innerHTML = "";
    q.options.forEach((opt, i) => {
        const id = `opt-${q.id}-${i}`;
        const wrapper = document.createElement("label");
        wrapper.className = "option";
        if (reviewMode) {
            const chosen = engine.answers[q.id];
            if (i === q.correctIndex) wrapper.classList.add("correct");
            if (chosen === i && i !== q.correctIndex) wrapper.classList.add("incorrect");
        }

        const input = document.createElement("input");
        input.type = "radio";
        input.name = "option";
        input.value = String(i);
        input.id = id;
        input.checked = engine.getSelectedIndex() === i;

        const span = document.createElement("span");
        span.textContent = opt;

        wrapper.append(input, span);
        els.form.append(wrapper);
    });
}

function renderNav() {
    const hasSelection = Number.isInteger(engine.getSelectedIndex());
    els.btnPrev.disabled = engine.currentIndex === 0;
    els.btnNext.disabled = !(engine.currentIndex < engine.length - 1 && hasSelection);
    els.btnFinish.disabled = !(engine.currentIndex === engine.length - 1 && hasSelection);
}

function renderResult(summary) {
    els.result.classList.remove("hidden");
    const pct = Math.round(summary.percent * 100);
    const status = summary.passed ? "Пройден ✅" : "Не пройден ❌";
    els.resultSummary.textContent = `${summary.correct} из ${summary.total} (${pct}%) — ${status}`;
}

// ========== Сохранение ==========
function persist() {
    if (!engine) return;
    try {
        StorageService.saveState(engine.toState());
    } catch (err) {
        console.warn("Не удалось сохранить состояние", err);
    }
}