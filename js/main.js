const close1 = document.querySelector(".pop-up-close");
const popUp = document.querySelector(".pop-up");

close1.addEventListener("click", () => {
    popUp.classList.add("_hidden")
})