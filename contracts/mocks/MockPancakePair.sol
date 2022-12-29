// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.17;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

contract MockPancakePair is ReentrancyGuard {
    constructor() {}

    function swap(
        address token,
        address to,
        uint256 amountOutMin
    ) public nonReentrant {
        IERC20(token).transfer(to, amountOutMin);
    }
}
