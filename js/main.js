'use strict';

(() => {
  const knownStories = new Set(document.body.dataset.stories.split(','));
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const savedKey = 'noemi-saved-v1';
  const readingKey = 'noemi-reading-v1';
  let storageAvailable = true;
  let savedChanged = () => {};

  function storageWarning() {
    document.querySelectorAll('.storage-note').forEach((note) => {
      note.hidden = false;
      note.textContent =
        'Браузер не разрешает сохранение. Выбор доступен на этой странице, но не сохранится после перехода или обновления.';
    });
  }

  function readJSON(key, fallback) {
    let raw;
    try {
      raw = localStorage.getItem(key);
    } catch {
      storageAvailable = false;
      return fallback;
    }
    if (!raw) return fallback;
    try {
      return JSON.parse(raw);
    } catch {
      return fallback;
    }
  }

  function writeJSON(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      storageAvailable = false;
      storageWarning();
    }
  }

  function readSaved() {
    const value = readJSON(savedKey, []);
    return new Set(Array.isArray(value) ? value.filter((id) => knownStories.has(id)) : []);
  }

  function readProgress() {
    const value = readJSON(readingKey, {});
    if (!value || Array.isArray(value) || typeof value !== 'object') return {};
    return Object.fromEntries(
      Object.entries(value).filter(
        ([id, position]) =>
          knownStories.has(id) && Number.isFinite(position) && position > 0 && position < 1,
      ),
    );
  }

  let saved = readSaved();
  if (!storageAvailable) storageWarning();

  function animateFeedback(element, frames, duration) {
    if (!element || reducedMotion.matches || typeof element.animate !== 'function') return;
    element.getAnimations().forEach((animation) => animation.cancel());
    element.animate(frames, { duration, easing: 'cubic-bezier(.2,.65,.2,1)' });
  }

  const notice = document.querySelector('.notice');
  const noticeMessage = notice.querySelector('.notice__message');
  const noticeUndo = notice.querySelector('.notice__undo');
  let noticeTimer;
  let undoAction;
  let noticeSource;

  function hideNotice() {
    clearTimeout(noticeTimer);
    if (notice.contains(document.activeElement)) {
      const target =
        noticeSource?.isConnected && noticeSource.getClientRects().length
          ? noticeSource
          : document.querySelector('main');
      target.focus({ preventScroll: true });
    }
    notice.hidden = true;
    undoAction = undefined;
  }

  function scheduleNotice() {
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => {
      if (notice.matches(':hover') || notice.contains(document.activeElement)) scheduleNotice();
      else hideNotice();
    }, 8000);
  }

  function tell(message, undo, source) {
    noticeSource = source || document.activeElement;
    undoAction = undo;
    noticeUndo.hidden = !undo;
    notice.hidden = false;
    noticeMessage.textContent = message;
    scheduleNotice();
  }

  notice.querySelector('.notice__close').addEventListener('click', hideNotice);
  noticeUndo.addEventListener('click', () => {
    const action = undoAction;
    hideNotice();
    action?.();
  });

  function syncSaved() {
    document.querySelectorAll('[data-saved-count]').forEach((count) => {
      count.textContent = String(saved.size);
    });
    const shortcut = document.querySelector('.header__saved');
    shortcut.hidden = false;
    shortcut.setAttribute('aria-label', `Отложенные статьи: ${saved.size}`);
    document.querySelectorAll('[data-save]').forEach((button) => {
      const selected = saved.has(button.dataset.save);
      button.hidden = false;
      button.setAttribute('aria-pressed', String(selected));
      button.setAttribute(
        'aria-label',
        `${selected ? 'Убрать из отложенного' : 'Отложить статью'} «${button.dataset.title}»`,
      );
      button.querySelector('.save-button__text').textContent = selected ? 'Сохранено' : 'Отложить';
    });
    savedChanged();
  }

  function setSaved(id, selected) {
    if (!knownStories.has(id)) return;
    if (selected) saved.add(id);
    else saved.delete(id);
    writeJSON(savedKey, [...saved]);
    syncSaved();
  }

  document.addEventListener('click', (event) => {
    const button = event.target.closest('[data-save]');
    if (!button) return;
    const id = button.dataset.save;
    const wasSaved = saved.has(id);
    setSaved(id, !wasSaved);
    animateFeedback(
      button.querySelector(saved.has(id) ? '.icon--bookmark-check' : '.icon--bookmark'),
      [
        { transform: 'translateY(-3px) rotate(-9deg)' },
        { transform: 'translateY(1px) rotate(3deg)', offset: 0.65 },
        { transform: 'none' },
      ],
      280,
    );
    tell(
      `Статья «${button.dataset.title}» ${wasSaved ? 'убрана из отложенного' : 'отложена'}.`,
      () => {
        setSaved(id, wasSaved);
        tell(wasSaved ? 'Статья снова в отложенном.' : 'Сохранение отменено.');
      },
      button,
    );
    noticeUndo.textContent = wasSaved ? 'Вернуть' : 'Отменить';
  });
  syncSaved();

  // The browser's Back button restores the same reading selection as the URL.
  const journal = document.querySelector('.journal');
  if (journal) {
    const cards = [...journal.querySelectorAll('.story-card')];
    const tools = journal.querySelector('.journal__tools');
    const input = journal.querySelector('#search');
    const search = journal.querySelector('.search');
    const clearSearch = journal.querySelector('.search__clear');
    const filters = [...journal.querySelectorAll('.filters__button')];
    const categories = new Set(filters.map((button) => button.dataset.category));
    const count = journal.querySelector('.journal__count');
    const empty = journal.querySelector('.journal__empty');
    const more = journal.querySelector('.journal__more');
    const reset = journal.querySelector('.journal__reset');
    const heading = journal.querySelector('#journal-title');
    const plural = new Intl.PluralRules('ru');
    const nouns = { one: 'материал', few: 'материала', many: 'материалов', other: 'материала' };
    const normalize = (value) =>
      value.toLocaleLowerCase('ru').replaceAll('ё', 'е').normalize('NFKC');
    let category = 'all';
    let query = '';
    let limit = 6;
    let searchTimer;

    function readURL() {
      const params = new URLSearchParams(location.search);
      const requested = params.get('saved') === '1' ? 'saved' : params.get('category');
      category = categories.has(requested) ? requested : 'all';
      query = (params.get('q') || '').slice(0, 120);
      input.value = query;
      limit = 6;
    }

    function updateURL(push = false) {
      const url = new URL(location.href);
      ['q', 'category', 'saved'].forEach((key) => url.searchParams.delete(key));
      if (query.trim()) url.searchParams.set('q', query.trim());
      if (category === 'saved') url.searchParams.set('saved', '1');
      else if (category !== 'all') url.searchParams.set('category', category);
      const method = push ? 'pushState' : 'replaceState';
      if (url.href !== location.href) history[method](null, '', url);
    }

    function render(feedback = false) {
      const terms = normalize(query.trim()).split(/\s+/).filter(Boolean);
      const matches = cards.filter((card) => {
        const categoryMatch =
          category === 'all' ||
          (category === 'saved'
            ? saved.has(card.dataset.storyId)
            : card.dataset.category === category);
        return (
          categoryMatch && terms.every((term) => normalize(card.dataset.search).includes(term))
        );
      });
      const shown = matches.slice(0, limit);
      cards.forEach((card) => {
        card.hidden = !shown.includes(card);
      });
      filters.forEach((button) =>
        button.setAttribute('aria-pressed', String(button.dataset.category === category)),
      );
      clearSearch.disabled = !query;
      reset.hidden = category === 'all' && !query;
      empty.hidden = !!matches.length;
      more.hidden = matches.length <= limit;
      more.textContent = `Ещё ${Math.min(6, matches.length - limit)} ${nouns[plural.select(Math.min(6, matches.length - limit))]}`;
      const label =
        category === 'all'
          ? 'Все истории'
          : filters
              .find((button) => button.dataset.category === category)
              .textContent.replace(/\s+\d+\s*$/, '')
              .trim();
      const amount =
        shown.length < matches.length
          ? `${shown.length} из ${matches.length} материалов`
          : `${matches.length} ${nouns[plural.select(matches.length)]}`;
      count.textContent = `${label}: ${amount}${query.trim() ? ` по запросу «${query.trim()}»` : ''}.`;
      if (!matches.length) {
        const savedEmpty = category === 'saved' && !saved.size;
        empty.querySelector('h3').textContent = savedEmpty
          ? 'Пока нет отложенных историй'
          : 'Не нашлось истории по этому выбору';
        empty.querySelector('p').textContent = savedEmpty
          ? 'Нажмите на закладку у понравившейся статьи. Здесь будет ваша небольшая подборка для чтения.'
          : 'Попробуйте другое слово или уберите рубрику. Например, поищите «дом» или «утро».';
      }
      if (feedback)
        animateFeedback(
          count,
          [{ backgroundColor: '#eee8d5' }, { backgroundColor: 'transparent' }],
          400,
        );
      if (cards.some((card) => card.hidden && card.contains(document.activeElement)))
        heading.focus({ preventScroll: true });
      return shown;
    }

    function resetSelection() {
      clearTimeout(searchTimer);
      category = 'all';
      query = '';
      input.value = '';
      limit = 6;
      updateURL(true);
      render(true);
    }

    tools.hidden = false;
    readURL();
    render();
    savedChanged = () => render(true);
    filters.forEach((button) =>
      button.addEventListener('click', () => {
        clearTimeout(searchTimer);
        query = input.value;
        category = button.dataset.category;
        limit = 6;
        updateURL(true);
        render(true);
      }),
    );
    input.addEventListener('input', () => {
      clearTimeout(searchTimer);
      query = input.value;
      clearSearch.disabled = !query;
      searchTimer = setTimeout(() => {
        limit = 6;
        updateURL();
        render(true);
      }, 180);
    });
    search.addEventListener('submit', (event) => {
      event.preventDefault();
      clearTimeout(searchTimer);
      query = input.value;
      limit = 6;
      updateURL();
      render(true);
      heading.focus();
    });
    clearSearch.addEventListener('click', () => {
      clearTimeout(searchTimer);
      query = '';
      input.value = '';
      limit = 6;
      updateURL();
      render(true);
      input.focus();
    });
    reset.addEventListener('click', resetSelection);
    empty.querySelector('[data-reset]').addEventListener('click', () => {
      resetSelection();
      heading.focus();
    });
    more.addEventListener('click', () => {
      const previous = render().length;
      limit += 6;
      const shown = render(true);
      const nextLink = shown[previous]?.querySelector('h3 a');
      if (nextLink) nextLink.focus();
    });
    document.querySelector('.header__saved').addEventListener('click', (event) => {
      event.preventDefault();
      clearTimeout(searchTimer);
      query = '';
      input.value = '';
      category = 'saved';
      limit = 6;
      updateURL(true);
      render(true);
      journal.scrollIntoView({ behavior: reducedMotion.matches ? 'instant' : 'smooth' });
      heading.focus({ preventScroll: true });
    });
    window.addEventListener('popstate', () => {
      clearTimeout(searchTimer);
      readURL();
      render(true);
    });
  }

  const menu = document.querySelector('#site-menu');
  const menuButton = document.querySelector('.header__toggle');
  const header = document.querySelector('.header');
  const compact = window.matchMedia('(max-width: 900px)');
  function closeMenu() {
    menuButton.setAttribute('aria-expanded', 'false');
    menuButton.setAttribute('aria-label', 'Открыть меню');
    menu.hidden = compact.matches;
  }
  function adaptMenu() {
    menuButton.hidden = !compact.matches;
    if (compact.matches && menu.contains(document.activeElement)) menuButton.focus();
    closeMenu();
  }
  menuButton.addEventListener('click', () => {
    const open = menuButton.getAttribute('aria-expanded') !== 'true';
    menu.hidden = !open;
    menuButton.setAttribute('aria-expanded', String(open));
    menuButton.setAttribute('aria-label', open ? 'Закрыть меню' : 'Открыть меню');
  });
  header.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && compact.matches && !menu.hidden) {
      closeMenu();
      menuButton.focus();
    }
  });
  menu.addEventListener('click', (event) => {
    if (event.target.closest('a')) closeMenu();
  });
  document.addEventListener('pointerdown', (event) => {
    if (compact.matches && !header.contains(event.target)) closeMenu();
  });
  compact.addEventListener('change', adaptMenu);
  adaptMenu();

  const dialog = document.querySelector('.feedback');
  if (typeof dialog.showModal === 'function') {
    document.querySelectorAll('[data-feedback]').forEach((button) => {
      button.hidden = false;
      button.addEventListener('click', () => dialog.showModal());
    });
    dialog.querySelector('[data-close]').addEventListener('click', () => dialog.close());
    dialog.addEventListener('click', (event) => {
      const rect = dialog.getBoundingClientRect();
      if (
        event.target === dialog &&
        (event.clientX < rect.left ||
          event.clientX > rect.right ||
          event.clientY < rect.top ||
          event.clientY > rect.bottom)
      )
        dialog.close();
    });
    const form = dialog.querySelector('form');
    const message = form.querySelector('#feedback-message');
    const error = form.querySelector('.field-error');
    const errors = form.querySelector('.form-errors');
    const status = form.querySelector('.feedback__status');
    form.addEventListener('input', () => {
      status.textContent = '';
    });
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      status.textContent = '';
      const valid = !!message.value.trim();
      error.hidden = valid;
      errors.hidden = valid;
      message.setAttribute('aria-invalid', String(!valid));
      if (!valid) {
        error.textContent = 'Напишите, о чём вам хотелось бы прочитать.';
        const link = document.createElement('a');
        link.href = '#feedback-message';
        link.textContent = error.textContent;
        link.addEventListener('click', (e) => {
          e.preventDefault();
          message.focus();
        });
        const item = document.createElement('li');
        item.append(link);
        errors.querySelector('ul').replaceChildren(item);
        errors.focus();
        return;
      }
      form.reset();
      status.textContent = 'Отзыв заполнен. В учебной версии он не отправляется и не сохраняется.';
    });
    message.addEventListener('input', () => {
      status.textContent = '';
      if (message.value.trim()) {
        error.hidden = true;
        errors.hidden = true;
        message.removeAttribute('aria-invalid');
      }
    });
  }

  const letters = document.querySelector('.letters__form');
  if (letters) {
    const email = letters.querySelector('input');
    const error = letters.querySelector('.field-error');
    const status = letters.querySelector('.letters__status');
    let attempted = false;
    function validateEmail() {
      const valid = !!email.value.trim() && email.validity.valid;
      email.setAttribute('aria-invalid', String(!valid));
      error.hidden = valid;
      error.textContent = valid ? '' : 'Введите email в формате name@example.com.';
      return valid;
    }
    letters.addEventListener('submit', (event) => {
      event.preventDefault();
      attempted = true;
      status.textContent = '';
      if (!validateEmail()) {
        email.focus();
        return;
      }
      letters.reset();
      status.textContent =
        'Форма заполнена верно. В учебной версии подписка не оформляется, email не отправлен.';
    });
    email.addEventListener('input', () => {
      status.textContent = '';
      if (attempted && email.validity.valid && email.value.trim()) validateEmail();
    });
    email.addEventListener('blur', () => {
      if (attempted || email.value) validateEmail();
    });
    letters.querySelector('fieldset').disabled = false;
  }

  // Store a proportion of the reading area, so resuming also works after a resize.
  const content = document.querySelector('#article-content');
  if (content) {
    const id = document.body.dataset.story;
    const progress = document.querySelector('.reading-progress');
    const bar = progress.querySelector('span');
    const resume = document.querySelector('.article__resume');
    const previous = readProgress()[id];
    const sections = [...content.querySelectorAll('.article__section')];
    const contentsLinks = [...document.querySelectorAll('.contents a')];
    let start = 0;
    let distance = 1;
    let sectionPositions = [];
    let proportion = 0;
    let frame;
    let saveTimer;
    function measure() {
      start = content.getBoundingClientRect().top + window.scrollY - innerHeight * 0.25;
      distance = Math.max(1, content.offsetHeight - innerHeight * 0.55);
      sectionPositions = sections.map(
        (section) => section.getBoundingClientRect().top + window.scrollY,
      );
      update();
    }
    function persistProgress() {
      if (proportion <= 0.03) return;
      const positions = readProgress();
      if (proportion >= 0.97) delete positions[id];
      else positions[id] = Number(proportion.toFixed(4));
      writeJSON(readingKey, positions);
    }
    function update() {
      frame = undefined;
      proportion = Math.max(0, Math.min(1, (window.scrollY - start) / distance));
      const value = Math.round(proportion * 100);
      bar.style.transform = `scaleX(${proportion})`;
      progress.setAttribute('aria-valuenow', String(value));
      let active = 0;
      sectionPositions.forEach((top, index) => {
        if (top <= window.scrollY + innerHeight * 0.33) active = index;
      });
      contentsLinks.forEach((link, index) => {
        if (index === active) link.setAttribute('aria-current', 'location');
        else link.removeAttribute('aria-current');
      });
      clearTimeout(saveTimer);
      saveTimer = setTimeout(persistProgress, 700);
    }
    progress.hidden = false;
    if (previous > 0.03 && previous < 0.97) {
      resume.hidden = false;
      resume.querySelector('button').addEventListener('click', () => {
        resume.hidden = true;
        measure();
        window.scrollTo({ top: Math.max(0, start + previous * distance), behavior: 'instant' });
        const target =
          sections.filter((section) => section.getBoundingClientRect().top < innerHeight).at(-1) ||
          content;
        target.setAttribute('tabindex', '-1');
        target.focus({ preventScroll: true });
      });
    }
    measure();
    new ResizeObserver(measure).observe(content);
    document.fonts.ready.then(measure);
    window.addEventListener('resize', measure);
    window.addEventListener(
      'scroll',
      () => {
        if (!frame) frame = requestAnimationFrame(update);
      },
      { passive: true },
    );
    window.addEventListener('pagehide', persistProgress);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) persistProgress();
    });
    const copy = document.querySelector('.article__copy');
    copy.hidden = false;
    copy.addEventListener('click', async () => {
      copy.disabled = true;
      try {
        if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
        await navigator.clipboard.writeText(location.href);
        tell('Ссылка на историю скопирована.', undefined, copy);
      } catch {
        const fallback = document.querySelector('.article__copy-fallback');
        fallback.hidden = false;
        const field = fallback.querySelector('input');
        field.value = location.href;
        field.focus();
        field.select();
        tell('Ссылка выделена. Скопируйте её привычным способом.', undefined, field);
      } finally {
        copy.disabled = false;
      }
    });
  }

  const clearData = document.querySelector('[data-clear-storage]');
  if (clearData) {
    clearData.hidden = false;
    clearData.addEventListener('click', () => {
      const beforeSaved = [...saved];
      const beforeProgress = readProgress();
      let cleared = true;
      try {
        localStorage.removeItem(savedKey);
        localStorage.removeItem(readingKey);
      } catch {
        storageAvailable = false;
        cleared = false;
      }
      saved.clear();
      syncSaved();
      document.querySelector('.privacy__status').textContent = cleared
        ? 'Закладки и место чтения очищены.'
        : 'Браузер не разрешает изменять сохранённые данные. На этой странице выбор сброшен.';
      if (!cleared) {
        tell('Браузер не разрешает очистить сохранённые данные.', undefined, clearData);
        return;
      }
      tell(
        'Данные Noémi очищены.',
        () => {
          saved = new Set(beforeSaved);
          writeJSON(savedKey, beforeSaved);
          writeJSON(readingKey, beforeProgress);
          syncSaved();
          document.querySelector('.privacy__status').textContent =
            'Закладки и место чтения восстановлены.';
          tell('Очистка отменена.', undefined, clearData);
        },
        clearData,
      );
      noticeUndo.textContent = 'Отменить очистку';
    });
  }

  window.addEventListener('storage', (event) => {
    if (event.key === savedKey || event.key === null) {
      saved = readSaved();
      syncSaved();
    }
  });
  reducedMotion.addEventListener('change', () => {
    if (reducedMotion.matches)
      document.querySelectorAll('[data-save] .icon,.journal__count').forEach((element) => {
        element.getAnimations().forEach((animation) => animation.cancel());
      });
  });
})();
