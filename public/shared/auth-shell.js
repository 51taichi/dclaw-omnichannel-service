(function registerAuthShell(global) {
  const IMAGE_BY_STATE = {
    idle: "/shared/assets/auth-question.png",
    failure: "/shared/assets/auth-failure.png",
    success: "/shared/assets/auth-success.png"
  };

  function mount({
    root,
    title,
    prompt,
    accountLabel = "",
    fieldLabel,
    inputType = "text",
    submitLabel,
    onSubmit
  }) {
    if (!root) throw new Error("auth shell root is required");
    let state = "idle";
    let busy = false;
    let countdownTimer = 0;

    root.innerHTML = `
      <main class="auth-shell is-idle">
        <section class="auth-shell-card" aria-live="polite">
          <img
            class="auth-shell-logo"
            src="/console/assets/deepmega-dclaw-logo.png"
            alt="DeepMega DClaw"
          />
          <div class="auth-shell-content">
            <div class="auth-shell-form-column">
              <header class="auth-shell-heading">
                <h1 class="auth-shell-title"></h1>
                <p class="auth-shell-prompt"></p>
              </header>
              <div class="auth-shell-account" hidden>
                <span>账号</span>
                <strong></strong>
              </div>
              <form class="auth-shell-form">
                <label>
                  <span class="auth-shell-field-label"></span>
                  <input class="auth-shell-input" autocomplete="off" required />
                </label>
                <p class="auth-shell-message" role="status"></p>
                <button class="auth-shell-submit" type="submit"></button>
              </form>
            </div>
            <div class="auth-shell-mascot-slot" aria-hidden="true">
              <img class="auth-shell-mascot" alt="" />
            </div>
          </div>
        </section>
      </main>
    `;

    const shell = root.querySelector(".auth-shell");
    const titleEl = root.querySelector(".auth-shell-title");
    const promptEl = root.querySelector(".auth-shell-prompt");
    const accountEl = root.querySelector(".auth-shell-account");
    const accountValue = accountEl.querySelector("strong");
    const form = root.querySelector(".auth-shell-form");
    const fieldLabelEl = root.querySelector(".auth-shell-field-label");
    const input = root.querySelector(".auth-shell-input");
    const messageEl = root.querySelector(".auth-shell-message");
    const submitButton = root.querySelector(".auth-shell-submit");
    const mascot = root.querySelector(".auth-shell-mascot");

    titleEl.textContent = title;
    promptEl.textContent = prompt;
    fieldLabelEl.textContent = fieldLabel;
    input.type = inputType;
    submitButton.textContent = submitLabel;
    if (accountLabel) {
      accountEl.hidden = false;
      accountValue.textContent = accountLabel;
    }

    function renderState(nextState, message = "") {
      state = nextState;
      shell.classList.remove("is-idle", "is-failure", "is-success");
      shell.classList.add(`is-${state}`);
      mascot.src = IMAGE_BY_STATE[state];
      messageEl.textContent = message;
    }

    function setBusy(isBusy) {
      busy = Boolean(isBusy);
      input.disabled = busy;
      submitButton.disabled = busy;
      shell.setAttribute("aria-busy", String(busy));
    }

    function setIdle({ prompt: nextPrompt } = {}) {
      state = "idle";
      if (nextPrompt !== undefined) promptEl.textContent = nextPrompt;
      setBusy(false);
      renderState(state);
    }

    function setFailure(message) {
      state = "failure";
      setBusy(false);
      renderState(state, message);
      input.select();
    }

    function showSuccess({ message, seconds = 3, onComplete }) {
      state = "success";
      setBusy(true);
      let remaining = seconds;
      const renderCountdown = () => {
        renderState(state, `${message}，${remaining} 秒后进入`);
      };
      renderCountdown();
      global.clearInterval(countdownTimer);
      countdownTimer = global.setInterval(() => {
        remaining -= 1;
        if (remaining <= 0) {
          global.clearInterval(countdownTimer);
          countdownTimer = 0;
          onComplete?.();
          return;
        }
        renderCountdown();
      }, 1000);
    }

    function focus() {
      input.focus();
    }

    function destroy() {
      global.clearInterval(countdownTimer);
      countdownTimer = 0;
      root.replaceChildren();
    }

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (busy) return;
      setBusy(true);
      try {
        await onSubmit?.(input.value, {
          setIdle,
          setBusy,
          setFailure,
          showSuccess,
          focus
        });
      } catch (error) {
        setFailure(error?.message || "验证失败，请重试");
      }
    });

    renderState(state);
    return {
      input,
      setIdle,
      setBusy,
      setFailure,
      showSuccess,
      focus,
      destroy
    };
  }

  global.AuthShell = { mount };
})(window);
