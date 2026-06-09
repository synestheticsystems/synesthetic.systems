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
      <header className="site-header">
        <DistortTitle className="logo" text="Synesthetic Systems" />
      </header>
    </>
  );
}

export default App;
