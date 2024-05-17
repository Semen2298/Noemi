const btnFormClose = document.querySelector(".pop-up-close");
const popup = document.querySelector(".pop-up")

btnFormClose.addEventListener("click", () => {
    popup.style.display = "none"
})