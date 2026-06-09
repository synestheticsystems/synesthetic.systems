import DistortTitle from './DistortTitle';
import ErrorBoundary from './ErrorBoundary';
import LizardField from './lizard/LizardField';
import './App.css';

function App() {
  return (
    <>
      <ErrorBoundary fallback={<div className="lizard-canvas lizard-unsupported" aria-hidden="true" />}>
        <LizardField />
      </ErrorBoundary>
      <main className="hero">
        <div className="hero-inner">
          <DistortTitle className="hero-title" text="Synesthetic Systems" />
        </div>
      </main>
    </>
  );
}

export default App;
