const endpoint = (path) => `backend/${path}`;

async function request(path, options = {}) {
  let response;
  try {
    response = await fetch(endpoint(path), {
      credentials: 'same-origin',
      ...options,
      headers: {
        ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
        ...options.headers,
      },
    });
  } catch {
    throw new Error('Não foi possível conectar ao servidor local. Inicie o Node.js com npm start.');
  }
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.toLowerCase().includes('application/json')) {
    throw new Error('A API local não respondeu. Inicie o projeto com npm start.');
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.erro || 'Não foi possível concluir a solicitação.');
  }
  return payload;
}

export const api = {
  session: () => request('auth/me.php'),
  login: (email, senha) => request('auth/login.php', { method: 'POST', body: JSON.stringify({ email, senha }) }),
  register: (data) => request('auth/register.php', { method: 'POST', body: JSON.stringify(data) }),
  logout: () => request('auth/logout.php', { method: 'POST', body: '{}' }),
  publications: (query = '') => request(`api/get_publicacoes.php${query ? `?${query}` : ''}`),
  profile: () => request('api/get_perfil.php'),
  like: (id_publicacao) => request('api/curtir.php', { method: 'POST', body: JSON.stringify({ id_publicacao }) }),
  upload: (formData) => request('api/cadastrar_foto.php', { method: 'POST', body: formData }),
  remove: (id_publicacao) => request('api/deletar_foto.php', { method: 'POST', body: JSON.stringify({ id_publicacao }) }),
};
