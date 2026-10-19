import { createRoot } from 'react-dom/client';
import '@fontsource/open-sans/400.css';
import '@fontsource/open-sans/600.css';
import '@fontsource/open-sans/700.css';
import './styles.css';
import App from './App.jsx';
import Overlay from './Overlay.jsx';

// The same page serves the main window and the small floating prompt / recording indicator.
const Root = location.hash.startsWith('#overlay') ? Overlay : App;
createRoot(document.getElementById('root')).render(<Root />);
