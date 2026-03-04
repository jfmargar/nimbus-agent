const MENU_BTN_PROJECTS = 'Projects';
const MENU_BTN_RESUME_LAST = 'Reanudar última';
const MENU_BTN_FOLLOW_ACTIVE = 'Seguir sesión activa';
const MENU_BTN_HIDE_KEYBOARD = 'Ocultar teclado';

function buildMainMenuKeyboard(options = {}) {
  const { includeFollow = false } = options;
  const keyboard = [
    [{ text: MENU_BTN_PROJECTS }],
    [{ text: MENU_BTN_RESUME_LAST }],
  ];
  if (includeFollow) {
    keyboard.push([{ text: MENU_BTN_FOLLOW_ACTIVE }]);
  }
  keyboard.push([{ text: MENU_BTN_HIDE_KEYBOARD }]);
  return {
    keyboard,
    resize_keyboard: true,
    is_persistent: true,
  };
}

module.exports = {
  buildMainMenuKeyboard,
  MENU_BTN_FOLLOW_ACTIVE,
  MENU_BTN_HIDE_KEYBOARD,
  MENU_BTN_PROJECTS,
  MENU_BTN_RESUME_LAST,
};
