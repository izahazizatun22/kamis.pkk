document.addEventListener('DOMContentLoaded', () => {
  const carousels = document.querySelectorAll('.carousel');

  carousels.forEach(carousel => {
    const inner = carousel.querySelector('.carousel-inner');
    const items = inner.querySelectorAll('.carousel-item');
    let currentIndex = 0;

    function showNextItem() {
      currentIndex = (currentIndex + 1) % items.length;
      const offset = -currentIndex * 100;
      inner.style.transform = `translateX(${offset}%)`;
    }

    setInterval(showNextItem, 3000); // Change slide every 3 seconds
  });
});
