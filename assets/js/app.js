import { api } from './api.js?v=20261110-4';
import { closeLoginModal, getUser, initializeAuth, openLoginModal } from './auth.js?v=20261110-4';

const gallery = document.querySelector('#gallery');
const searchForm = document.querySelector('#search-form');
const searchInput = document.querySelector('#photographer-search');
const searchError = document.querySelector('#search-error');
const statusMessage = document.querySelector('#status-message');
const profileButton = document.querySelector('#profile-button');
const profilePanel = document.querySelector('#profile-panel');
let showingOwn = false;
let activeSearch = '';

function announce(message, isError = false) {
  statusMessage.textContent = message;
  statusMessage.classList.toggle('is-error', isError);
}

function updateHeader(user) {
  const loginButton = document.querySelector('#login-button');
  const logoutButton = document.querySelector('#logout-button');
  const profileName = document.querySelector('#profile-name');
  const avatar = document.querySelector('#profile-avatar');
  loginButton.hidden = Boolean(user);
  logoutButton.hidden = !user;
  profileName.textContent = user ? `@${user.nome_usuario}` : '@SAEPVision';
  avatar.src = user?.foto_perfil || 'backend/api/media.php?tipo=avatar&arquivo=saepVision.jpeg';
  avatar.alt = user ? `Foto de perfil de ${user.nome}` : 'SAEPVision';
  profileButton.setAttribute('aria-disabled', String(!user || user.tipo_usuario !== 'fotografo'));
  profileButton.classList.toggle('is-disabled', !user || user.tipo_usuario !== 'fotografo');
  document.querySelector('#upload-section').hidden = !user || user.tipo_usuario !== 'fotografo';
  document.querySelector('#profile-open-label').textContent = user?.tipo_usuario === 'fotografo' ? 'Ver Perfil' : 'Ver Perfil';
  if (!user || user.tipo_usuario !== 'fotografo') closeProfilePanel();
}

function closeProfilePanel() {
  profilePanel.hidden = true;
  document.body.classList.remove('panel-open');
}

async function loadProfile() {
  const result = await api.profile();
  document.querySelector('#likes-total').textContent = Number(result.perfil.total_curtidas || 0).toLocaleString('pt-BR');
  document.querySelector('#publications-total').textContent = Number(result.perfil.total_publicacoes || 0).toLocaleString('pt-BR');
}

function addText(parent, tag, className, value) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  element.textContent = value;
  parent.append(element);
  return element;
}

function publicationCard(publication) {
  const user = getUser();
  const card = document.createElement('article');
  card.className = 'photo-card';
  card.dataset.publicationId = publication.id;

  const imageFrame = document.createElement('div');
  imageFrame.className = 'photo-frame';
  const image = document.createElement('img');
  image.src = publication.caminho_imagem;
  image.alt = publication.titulo;
  image.title = `${publication.titulo} | Foto tirada por: @${publication.nome_usuario}`;
  image.loading = 'lazy';
  imageFrame.append(image);

  const details = document.createElement('div');
  details.className = 'photo-details';
  const titleRow = document.createElement('div');
  titleRow.className = 'photo-title-row';
  addText(titleRow, 'h2', 'photo-title', publication.titulo);
  if (showingOwn && user?.tipo_usuario === 'fotografo' && Number(publication.id_fotografo) === Number(user.id)) {
    const deleteButton = document.createElement('button');
    deleteButton.className = 'icon-button delete-photo';
    deleteButton.type = 'button';
    deleteButton.setAttribute('aria-label', `Excluir ${publication.titulo}`);
    deleteButton.title = 'Excluir publicação';
    const trash = document.createElement('img');
    trash.src = 'assets/icons/lixeira.svg';
    trash.alt = '';
    deleteButton.append(trash);
    deleteButton.addEventListener('click', () => deletePublication(publication.id, card));
    titleRow.append(deleteButton);
  }
  details.append(titleRow);

  const likeRow = document.createElement('div');
  likeRow.className = 'like-row';
  const likeButton = document.createElement('button');
  likeButton.className = `like-button${Number(publication.curtida_pelo_usuario) ? ' is-liked' : ''}`;
  likeButton.type = 'button';
  likeButton.setAttribute('aria-label', Number(publication.curtida_pelo_usuario) ? 'Remover curtida' : 'Curtir publicação');
  likeButton.setAttribute('aria-pressed', String(Boolean(Number(publication.curtida_pelo_usuario))));
  const heart = document.createElement('span');
  heart.className = 'heart-icon';
  likeButton.append(heart);
  const count = addText(likeRow, 'span', 'like-count', Number(publication.total_curtidas || 0).toLocaleString('pt-BR'));
  likeRow.prepend(likeButton);
  likeButton.addEventListener('click', () => toggleLike(publication.id, likeButton, count));
  details.append(likeRow);
  addText(details, 'p', 'photo-credit', `Foto tirada por: @${publication.nome_usuario}`);
  addText(details, 'p', 'photo-location', `Local: ${publication.local_origem}`);
  card.append(imageFrame, details);
  return card;
}

async function loadGallery(query = '') {
  gallery.setAttribute('aria-busy', 'true');
  gallery.replaceChildren();
  const loading = document.createElement('p');
  loading.className = 'gallery-message';
  loading.textContent = 'Carregando publicações...';
  gallery.append(loading);
  const params = new URLSearchParams();
  if (showingOwn) params.set('minhas', '1');
  if (query) params.set('fotografo', query);
  try {
    const result = await api.publications(params.toString());
    gallery.replaceChildren();
    if (!result.publicacoes.length) {
      const empty = document.createElement('p');
      empty.className = 'gallery-message';
      empty.textContent = 'Nenhuma publicação encontrada.';
      gallery.append(empty);
      return;
    }
    result.publicacoes.forEach((publication) => gallery.append(publicationCard(publication)));
  } catch (error) {
    gallery.replaceChildren();
    const message = document.createElement('p');
    message.className = 'gallery-message is-error';
    message.textContent = error.message;
    gallery.append(message);
    if (error.message === 'Fotógrafo não encontrado') {
      searchError.textContent = 'Fotógrafo não encontrado';
      searchError.hidden = false;
    }
  } finally {
    gallery.removeAttribute('aria-busy');
  }
}

async function toggleLike(id, button, count) {
  if (!getUser()) {
    openLoginModal();
    return;
  }
  button.disabled = true;
  try {
    const result = await api.like(id);
    button.classList.toggle('is-liked', result.curtido);
    button.setAttribute('aria-pressed', String(result.curtido));
    button.setAttribute('aria-label', result.curtido ? 'Remover curtida' : 'Curtir publicação');
    count.textContent = Number(result.total_curtidas).toLocaleString('pt-BR');
  } catch (error) {
    announce(error.message, true);
  } finally {
    button.disabled = false;
  }
}

async function deletePublication(id, card) {
  if (!window.confirm('Deseja excluir esta publicação?')) return;
  try {
    await api.remove(id);
    card.remove();
    await loadProfile();
    announce('Publicação excluída.');
    if (!gallery.querySelector('.photo-card')) await loadGallery(activeSearch);
  } catch (error) {
    announce(error.message, true);
  }
}

searchForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!getUser()) {
    openLoginModal();
    return;
  }
  const query = searchInput.value.trim();
  searchError.hidden = true;
  if (query && !/^@?[\p{L}\p{N}_.-]{2,50}$/u.test(query)) {
    searchError.textContent = 'Formato inválido';
    searchError.hidden = false;
    return;
  }
  showingOwn = false;
  activeSearch = query;
  document.querySelector('#own-publications').setAttribute('aria-pressed', 'false');
  await loadGallery(query);
});
searchInput.addEventListener('click', () => {
  if (!getUser()) openLoginModal();
});
searchInput.addEventListener('input', () => {
  searchError.hidden = true;
});

profileButton.addEventListener('click', async () => {
  const user = getUser();
  if (!user) {
    openLoginModal();
    return;
  }
  if (user.tipo_usuario !== 'fotografo') return;
  profilePanel.hidden = false;
  document.body.classList.add('panel-open');
  try {
    await loadProfile();
  } catch (error) {
    announce(error.message, true);
  }
});
document.querySelector('#close-profile').addEventListener('click', closeProfilePanel);
document.querySelector('#own-publications').addEventListener('click', async (event) => {
  showingOwn = !showingOwn;
  activeSearch = '';
  searchInput.value = '';
  searchError.hidden = true;
  event.currentTarget.setAttribute('aria-pressed', String(showingOwn));
  closeProfilePanel();
  await loadGallery();
});
document.querySelector('#panel-backdrop').addEventListener('click', closeProfilePanel);

const uploadForm = document.querySelector('#upload-form');
const fileInput = document.querySelector('#image-file');
const fileName = document.querySelector('#file-name');
const uploadError = document.querySelector('#upload-error');
const titleError = document.querySelector('#title-error');
const originError = document.querySelector('#origin-error');
const fileError = document.querySelector('#file-error');
fileInput.addEventListener('change', () => {
  fileName.textContent = fileInput.files[0]?.name || 'Nenhum arquivo escolhido';
  fileError.textContent = '';
  const file = fileInput.files[0];
  if (file && !/\.(jpe?g|png|gif|webp)$/i.test(file.name)) {
    fileError.textContent = 'Formato inválido. Use JPG, JPEG, PNG, GIF ou WEBP.';
    fileInput.value = '';
    fileName.textContent = 'Nenhum arquivo escolhido';
  }
});
uploadForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  titleError.textContent = '';
  originError.textContent = '';
  fileError.textContent = '';
  uploadError.textContent = '';
  const title = uploadForm.elements.titulo.value.trim();
  const origin = uploadForm.elements.local_origem.value.trim();
  if (!title) {
    titleError.textContent = 'O título da imagem é obrigatório.';
    uploadForm.elements.titulo.focus();
    return;
  }
  if (!origin) {
    originError.textContent = 'A fonte de origem é obrigatória.';
    uploadForm.elements.local_origem.focus();
    return;
  }
  if (!fileInput.files[0]) {
    fileError.textContent = 'Nenhum arquivo escolhido';
    return;
  }
  const data = new FormData(uploadForm);
  const submit = uploadForm.querySelector('[type="submit"]');
  submit.disabled = true;
  try {
    await api.upload(data);
    uploadForm.reset();
    fileName.textContent = 'Nenhum arquivo escolhido';
    showingOwn = true;
    activeSearch = '';
    await loadGallery();
    await loadProfile();
    announce('Imagem cadastrada.');
  } catch (error) {
    uploadError.textContent = error.message;
  } finally {
    submit.disabled = false;
  }
});

document.addEventListener('auth:changed', (event) => {
  updateHeader(event.detail);
  showingOwn = false;
  activeSearch = '';
  searchInput.value = '';
  loadGallery();
});

await initializeAuth();
