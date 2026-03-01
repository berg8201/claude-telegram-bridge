const reveals = document.querySelectorAll('.reveal');

const observer = new IntersectionObserver(
  (entries, obs) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add('is-visible');
        obs.unobserve(entry.target);
      }
    });
  },
  { threshold: 0.18 }
);

reveals.forEach((item) => observer.observe(item));

const copyButtons = document.querySelectorAll('.copy-btn');

copyButtons.forEach((button) => {
  button.addEventListener('click', async () => {
    const targetId = button.getAttribute('data-copy-target');
    const code = document.getElementById(targetId);
    if (!code) return;

    try {
      await navigator.clipboard.writeText(code.innerText.trim());
      const originalText = button.innerText;
      button.innerText = 'Copied';
      button.classList.add('copied');

      setTimeout(() => {
        button.innerText = originalText;
        button.classList.remove('copied');
      }, 1400);
    } catch (_error) {
      button.innerText = 'Copy failed';
      setTimeout(() => {
        button.innerText = 'Copy command';
      }, 1400);
    }
  });
});

const sectionLinks = document.querySelectorAll('.topbar nav a[href^="#"]');
const sections = [...sectionLinks]
  .map((link) => document.querySelector(link.getAttribute('href')))
  .filter(Boolean);
const whereAmI = document.getElementById('whereami');
const sectionNames = {
  features: 'Features',
  demo: 'Demo',
  quickstart: 'Quickstart',
  faq: 'FAQ',
};

function setActiveLink(sectionId) {
  sectionLinks.forEach((link) => {
    const isActive = link.getAttribute('href') === `#${sectionId}`;
    link.classList.toggle('is-active', isActive);
  });
  if (whereAmI) {
    const label = sectionNames[sectionId] || 'Top';
    whereAmI.textContent = `You are here: ${label}`;
  }
}

const sectionObserver = new IntersectionObserver(
  (entries) => {
    const visible = entries
      .filter((entry) => entry.isIntersecting)
      .sort((a, b) => b.intersectionRatio - a.intersectionRatio);

    if (visible[0]?.target?.id) {
      setActiveLink(visible[0].target.id);
    }
  },
  { threshold: [0.25, 0.5, 0.75], rootMargin: '-20% 0px -45% 0px' }
);

sections.forEach((section) => sectionObserver.observe(section));

if (location.hash) {
  setActiveLink(location.hash.replace('#', ''));
} else {
  setActiveLink('features');
}
