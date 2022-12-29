// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import "@openzeppelin/contracts/utils/Counters.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

import "./interfaces/IWeStakeitToken.sol";

/**
 * @title WeSendit Staking Token
 */
contract WeStakeitToken is IWeStakeitToken, ERC721URIStorage, Ownable {
    using Counters for Counters.Counter;
    Counters.Counter private _tokenIds;

    constructor() ERC721("WeStakeit", "sWSI") {}

    function mint(
        address receiver
    ) external onlyOwner returns (uint256 tokenId) {
        tokenId = _tokenIds.current();

        _mint(receiver, tokenId);
        _setTokenURI(tokenId, "");

        _tokenIds.increment();
        return tokenId;
    }

    function burn(uint256 tokenId) external onlyOwner {
        _transfer(
            _msgSender(),
            0x000000000000000000000000000000000000dEaD,
            tokenId
        );
    }
}
