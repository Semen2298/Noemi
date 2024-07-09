<<<<<<< HEAD
const close1 = document.querySelector(".pop-up-close");
const popUp = document.querySelector(".pop-up");

close1.addEventListener("click", () => {
    popUp.classList.add("_hidden")
=======
const btnFormClose = document.querySelector(".pop-up-close");
const popup = document.querySelector(".pop-up")

btnFormClose.addEventListener("click", () => {
    popup.style.display = "none"
>>>>>>> ff7d5f8bd82517a3c950f26e86f77ea87a6c9dea
})