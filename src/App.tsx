import DistortTitle from './DistortTitle';
import LizardField from './lizard/LizardField';
import './App.css';

function App() {
  return (
    <>
      <LizardField />
      <main className="hero">
        <div className="hero-inner">
          <DistortTitle className="hero-title" text="Synesthetic Systems" />
        </div>
      </main>
    </>
  );
}

export default App;
