import './App.css';

const GITHUB_URL = 'https://github.com/soupledev/bookmark-everywhere';
const EMAIL = 'bookmark@souple.dev';

function App() {
  return (
    <main className="popup">
      <p className="popup__eyebrow">Bookmark Everywhere</p>
      <h1>Need help or have an idea?</h1>
      <div className="popup__actions">
        <a href={GITHUB_URL} target="_blank" rel="noreferrer">
          GitHub
        </a>
        <a href={`mailto:${EMAIL}`}>{EMAIL}</a>
      </div>
      {import.meta.env.DEV ? (
        <button
          type="button"
          className="popup__test"
          onClick={() => {
            throw new Error('Sentry popup test error');
          }}
        >
          Test Sentry
        </button>
      ) : null}
    </main>
  );
}

export default App;
