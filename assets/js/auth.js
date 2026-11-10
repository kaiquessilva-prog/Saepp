import { api } from './api.js?v=20261110-4';

let authenticatedUser = null;

function setAuthView(view) {
  const registering = view === 'register';
  document.querySelector('#login-view').hidden = registering;
  document.querySelector('#register-view').hidden = !registering;
  document.querySelector('.login-dialog').setAttribute('aria-labelledby', registering ? 'register-title' : 'login-title');
  if (registering) document.querySelector('#register-name').focus();
}

export function getUser() {
  return authenticatedUser;
}

export function setUser(user) {
  authenticatedUser = user;
  document.dispatchEvent(new CustomEvent('auth:changed', { detail: user }));
}

export function openLoginModal() {
  const modal = document.querySelector('#login-modal');
  setAuthView('login');
  modal.hidden = false;
  document.body.classList.add('modal-open');
  modal.querySelector('input[name="email"]').focus();
}

export function closeLoginModal() {
  document.querySelector('#login-modal').hidden = true;
  document.body.classList.remove('modal-open');
}

function showError(message) {
  const error = document.querySelector('#login-error');
  error.textContent = message;
  error.hidden = !message;
}

export async function initializeAuth() {
  const modal = document.querySelector('#login-modal');
  const form = document.querySelector('#login-form');
  const registerForm = document.querySelector('#register-form');
  const loginButton = document.querySelector('#login-button');
  const logoutButton = document.querySelector('#logout-button');

  document.querySelectorAll('[data-show-register]').forEach((button) => {
    button.addEventListener('click', () => setAuthView('register'));
  });
  document.querySelectorAll('[data-show-login]').forEach((button) => {
    button.addEventListener('click', () => setAuthView('login'));
  });

  document.querySelectorAll('[data-open-login]').forEach((button) => {
    button.addEventListener('click', openLoginModal);
  });
  document.querySelectorAll('[data-close-login]').forEach((button) => {
    button.addEventListener('click', closeLoginModal);
  });
  modal.addEventListener('click', (event) => {
    if (event.target === modal) closeLoginModal();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !modal.hidden) closeLoginModal();
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    showError('');
    const email = form.elements.email.value.trim();
    const senha = form.elements.senha.value;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      showError('E-mail inválido ou vazio');
      form.elements.email.focus();
      return;
    }
    if (!senha.trim()) {
      showError('A senha é obrigatória e não pode estar vazia');
      form.elements.senha.focus();
      return;
    }

    const submit = form.querySelector('[type="submit"]');
    submit.disabled = true;
    try {
      const result = await api.login(email, senha);
      setUser(result.usuario);
      form.reset();
      closeLoginModal();
      showError('');
    } catch (error) {
      showError(error.message === 'Usuário não encontrado ou senha incorreta.'
        ? 'Usuário não encontrado ou senha incorreta'
        : error.message);
    } finally {
      submit.disabled = false;
    }
  });

  registerForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const errorElement = document.querySelector('#register-error');
    errorElement.textContent = '';
    errorElement.hidden = true;

    const data = {
      nome: registerForm.elements.nome.value.trim(),
      nome_usuario: registerForm.elements.nome_usuario.value.trim(),
      email: registerForm.elements.email.value.trim(),
      senha: registerForm.elements.senha.value,
      tipo_usuario: registerForm.elements.tipo_usuario.value,
    };
    if (data.nome.length < 2) {
      errorElement.textContent = 'Informe seu nome completo.';
    } else if (!/^[\p{L}\p{N}_.-]{2,40}$/u.test(data.nome_usuario)) {
      errorElement.textContent = 'Nome de usuário inválido. Use de 2 a 40 letras, números, ponto, traço ou sublinhado.';
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) {
      errorElement.textContent = 'E-mail inválido ou vazio';
    } else if (data.senha.length < 8) {
      errorElement.textContent = 'A senha deve ter pelo menos 8 caracteres.';
    } else if (!['comum', 'fotografo'].includes(data.tipo_usuario)) {
      errorElement.textContent = 'Selecione um tipo de conta válido.';
    }
    if (errorElement.textContent) {
      errorElement.hidden = false;
      return;
    }

    const submit = registerForm.querySelector('[type="submit"]');
    submit.disabled = true;
    try {
      const result = await api.register(data);
      setUser(result.usuario);
      registerForm.reset();
      setAuthView('login');
      closeLoginModal();
    } catch (error) {
      errorElement.textContent = error.message;
      errorElement.hidden = false;
    } finally {
      submit.disabled = false;
    }
  });

  loginButton.addEventListener('click', openLoginModal);
  logoutButton.addEventListener('click', async () => {
    try {
      await api.logout();
      setUser(null);
    } catch (error) {
      document.querySelector('#status-message').textContent = error.message;
    }
  });

  try {
    const result = await api.session();
    authenticatedUser = result.usuario;
  } catch {
    authenticatedUser = null;
  }
  document.dispatchEvent(new CustomEvent('auth:changed', { detail: authenticatedUser }));
  return authenticatedUser;
}
